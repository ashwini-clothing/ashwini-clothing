import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { latestBackup,verifyBackup } from './verify-backup.js';
import { decryptBackupFile,isEncryptedBackup } from './backup-crypto.js';

const source=verifyBackup(process.argv[2]||latestBackup());
const testDir=fs.mkdtempSync(path.join(os.tmpdir(),'ashwini-restore-test-'));
const restored=path.join(testDir,'ashwini-restored.db');

try{
  if(isEncryptedBackup(source))decryptBackupFile(source,restored);else fs.copyFileSync(source,restored);
  const database=new Database(restored,{fileMustExist:true});
  try{
    const integrity=database.pragma('integrity_check',{simple:true});
    if(integrity!=='ok')throw new Error(`Restored database integrity check failed: ${integrity}`);
    const tables=database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count;
    if(!tables)throw new Error('Restored database contains no application tables');
    console.log(`[Ashwini backup] Restore test passed (${tables} application tables)`);
  }finally{database.close()}
}catch(error){
  console.error('[Ashwini backup] Restore test failed:',error.message);
  process.exitCode=1;
}finally{fs.rmSync(testDir,{recursive:true,force:true})}
