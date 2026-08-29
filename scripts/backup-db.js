import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const projectDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function backupDatabase(){
  const source=path.resolve(process.env.DB_PATH||path.join(projectDir,'ashwini.db'));
  if(!fs.existsSync(source))throw new Error(`Database not found: ${source}`);
  const backupDir=path.resolve(process.env.BACKUP_DIR||path.join(path.dirname(source),'backups'));
  fs.mkdirSync(backupDir,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const destination=path.join(backupDir,`ashwini-${stamp}.db`);
  const temporary=`${destination}.partial`;
  if(destination===source)throw new Error('Backup destination must differ from the live database');

  const database=new Database(source,{readonly:true,fileMustExist:true});
  try{
    await database.backup(temporary);
    const backup=new Database(temporary,{readonly:true,fileMustExist:true});
    try{
      const result=backup.pragma('integrity_check',{simple:true});
      if(result!=='ok')throw new Error(`Backup integrity check failed: ${result}`);
    }finally{backup.close()}
    fs.renameSync(temporary,destination);
  }catch(error){
    try{fs.unlinkSync(temporary)}catch{}
    throw error;
  }finally{database.close()}
  try{fs.chmodSync(destination,0o600)}catch{}
  const checksum=crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  fs.writeFileSync(`${destination}.sha256`,`${checksum}  ${path.basename(destination)}\n`,{mode:0o600});

  const retentionDays=Math.max(1,Number(process.env.BACKUP_RETENTION_DAYS)||14);
  const cutoff=Date.now()-retentionDays*24*60*60*1000;
  for(const entry of fs.readdirSync(backupDir,{withFileTypes:true})){
    if(!entry.isFile()||!/^ashwini-.*\.db(?:\.sha256)?$/.test(entry.name))continue;
    const file=path.join(backupDir,entry.name);
    if(fs.statSync(file).mtimeMs<cutoff)fs.unlinkSync(file);
  }
  return destination;
}

const invokedDirectly=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invokedDirectly){
  backupDatabase().then(file=>console.log(`[Ashwini backup] Created ${file}`)).catch(error=>{console.error('[Ashwini backup] Failed:',error.message);process.exitCode=1});
}
