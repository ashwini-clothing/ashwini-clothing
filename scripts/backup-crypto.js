import crypto from 'crypto';
import fs from 'fs';

const MAGIC=Buffer.from('ASHBKP01');
const IV_BYTES=12;
const TAG_BYTES=16;
const CHUNK_BYTES=1024*1024;

export function encryptionRequired(){return String(process.env.BACKUP_REQUIRE_ENCRYPTION||'').toLowerCase()==='true'||process.env.NODE_ENV==='production'}

export function backupEncryptionKey(){
  const raw=String(process.env.BACKUP_ENCRYPTION_KEY||'').trim();
  if(!raw){if(encryptionRequired())throw new Error('BACKUP_ENCRYPTION_KEY is required for encrypted production backups');return null}
  let key;
  if(/^[a-f0-9]{64}$/i.test(raw))key=Buffer.from(raw,'hex');
  else if(/^[A-Za-z0-9+/]{43}=$/.test(raw)||/^[A-Za-z0-9_-]{43}$/.test(raw))key=Buffer.from(raw.replace(/-/g,'+').replace(/_/g,'/')+(raw.length%4?'='.repeat(4-raw.length%4):''),'base64');
  else throw new Error('BACKUP_ENCRYPTION_KEY must be exactly 32 random bytes encoded as 64 hex characters or base64');
  if(key.length!==32)throw new Error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}

export function isEncryptedBackup(file){const fd=fs.openSync(file,'r');try{const header=Buffer.alloc(MAGIC.length);return fs.readSync(fd,header,0,header.length,0)===header.length&&header.equals(MAGIC)}finally{fs.closeSync(fd)}}

export function encryptBackupFile(source,destination,key=backupEncryptionKey()){
  if(!key)throw new Error('Backup encryption key is not configured');
  const input=fs.openSync(source,'r'),output=fs.openSync(destination,'wx',0o600),iv=crypto.randomBytes(IV_BYTES),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),buffer=Buffer.alloc(CHUNK_BYTES);
  try{fs.writeSync(output,MAGIC);fs.writeSync(output,iv);let bytes;while((bytes=fs.readSync(input,buffer,0,buffer.length,null))>0){const encrypted=cipher.update(buffer.subarray(0,bytes));if(encrypted.length)fs.writeSync(output,encrypted)}const final=cipher.final();if(final.length)fs.writeSync(output,final);fs.writeSync(output,cipher.getAuthTag());fs.fsyncSync(output)}finally{fs.closeSync(input);fs.closeSync(output)}
  return destination;
}

export function decryptBackupFile(source,destination,key=backupEncryptionKey()){
  if(!key)throw new Error('BACKUP_ENCRYPTION_KEY is required to restore this encrypted backup');
  const size=fs.statSync(source).size,minimum=MAGIC.length+IV_BYTES+TAG_BYTES;if(size<=minimum)throw new Error('Encrypted backup is truncated');
  const input=fs.openSync(source,'r'),output=fs.openSync(destination,'wx',0o600),header=Buffer.alloc(MAGIC.length),iv=Buffer.alloc(IV_BYTES),tag=Buffer.alloc(TAG_BYTES),buffer=Buffer.alloc(CHUNK_BYTES);
  try{fs.readSync(input,header,0,header.length,0);if(!header.equals(MAGIC))throw new Error('Encrypted backup header is invalid');fs.readSync(input,iv,0,iv.length,MAGIC.length);fs.readSync(input,tag,0,tag.length,size-TAG_BYTES);const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);let position=minimum-TAG_BYTES,remaining=size-position-TAG_BYTES;while(remaining>0){const wanted=Math.min(buffer.length,remaining),bytes=fs.readSync(input,buffer,0,wanted,position);if(!bytes)throw new Error('Encrypted backup ended unexpectedly');position+=bytes;remaining-=bytes;const plain=decipher.update(buffer.subarray(0,bytes));if(plain.length)fs.writeSync(output,plain)}const final=decipher.final();if(final.length)fs.writeSync(output,final);fs.fsyncSync(output)}catch(error){try{fs.closeSync(output)}catch{};try{fs.unlinkSync(destination)}catch{};throw new Error(`Encrypted backup authentication failed: ${error.message}`)}finally{fs.closeSync(input);try{fs.closeSync(output)}catch{}}
  return destination;
}

export function sha256File(file){const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(CHUNK_BYTES);try{let bytes;while((bytes=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,bytes));return hash.digest('hex')}finally{fs.closeSync(fd)}}
