import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { decryptBackupFile,isEncryptedBackup,sha256File } from './backup-crypto.js';

const projectDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const backupDir=path.resolve(process.env.BACKUP_DIR||path.join(path.dirname(path.resolve(process.env.DB_PATH||path.join(projectDir,'ashwini.db'))),'backups'));

export function latestBackup(){
  if(!fs.existsSync(backupDir))throw new Error(`Backup directory not found: ${backupDir}`);
  const files=fs.readdirSync(backupDir).filter(name=>/^ashwini-.*\.db(?:\.enc)?$/.test(name)).map(name=>path.join(backupDir,name));
  if(!files.length)throw new Error(`No database backups found in ${backupDir}`);
  return files.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
}

export function verifyBackup(file=latestBackup()){
  const resolved=path.resolve(file);
  const checksumFile=`${resolved}.sha256`;
  if(!fs.existsSync(checksumFile))throw new Error('Backup checksum file is missing');
  const expected=fs.readFileSync(checksumFile,'utf8').trim().split(/\s+/)[0];
  const actual=sha256File(resolved);
  if(!expected||expected!==actual)throw new Error('Backup checksum does not match');
  const testDir=fs.mkdtempSync(path.join(os.tmpdir(),'ashwini-verify-')),databaseFile=path.join(testDir,'verified.db');
  let database;
  try{
    if(isEncryptedBackup(resolved))decryptBackupFile(resolved,databaseFile);else fs.copyFileSync(resolved,databaseFile);
    database=new Database(databaseFile,{readonly:true,fileMustExist:true});
    const integrity=database.pragma('integrity_check',{simple:true});
    if(integrity!=='ok')throw new Error(`SQLite integrity check failed: ${integrity}`);
    const tables=database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count;
    if(!tables)throw new Error('Backup contains no application tables');
  }finally{database?.close();fs.rmSync(testDir,{recursive:true,force:true})}
  return resolved;
}

const invokedDirectly=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invokedDirectly){
  try{console.log(`[Ashwini backup] Verified ${verifyBackup(process.argv[2])}`)}catch(error){console.error('[Ashwini backup] Verification failed:',error.message);process.exitCode=1}
}
