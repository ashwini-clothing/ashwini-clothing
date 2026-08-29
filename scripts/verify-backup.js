import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const projectDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const backupDir=path.resolve(process.env.BACKUP_DIR||path.join(path.dirname(path.resolve(process.env.DB_PATH||path.join(projectDir,'ashwini.db'))),'backups'));

export function latestBackup(){
  if(!fs.existsSync(backupDir))throw new Error(`Backup directory not found: ${backupDir}`);
  const files=fs.readdirSync(backupDir).filter(name=>/^ashwini-.*\.db$/.test(name)).map(name=>path.join(backupDir,name));
  if(!files.length)throw new Error(`No database backups found in ${backupDir}`);
  return files.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
}

export function verifyBackup(file=latestBackup()){
  const resolved=path.resolve(file);
  const database=new Database(resolved,{readonly:true,fileMustExist:true});
  try{
    const integrity=database.pragma('integrity_check',{simple:true});
    if(integrity!=='ok')throw new Error(`SQLite integrity check failed: ${integrity}`);
    const tables=database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count;
    if(!tables)throw new Error('Backup contains no application tables');
  }finally{database.close()}
  const checksumFile=`${resolved}.sha256`;
  if(fs.existsSync(checksumFile)){
    const expected=fs.readFileSync(checksumFile,'utf8').trim().split(/\s+/)[0];
    const actual=crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
    if(!expected||expected!==actual)throw new Error('Backup checksum does not match');
  }
  return resolved;
}

const invokedDirectly=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invokedDirectly){
  try{console.log(`[Ashwini backup] Verified ${verifyBackup(process.argv[2])}`)}catch(error){console.error('[Ashwini backup] Verification failed:',error.message);process.exitCode=1}
}
