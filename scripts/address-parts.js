export function normalizeAddressParts(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Enter the delivery address fields');
 const parts={};for(const key of ['house','street','area','landmark']){if(value[key]!=null&&typeof value[key]!=='string')throw Error('Enter valid address text');parts[key]=(value[key]||'').trim();if(parts[key].length>500)throw Error('Address field is too long')}
 const line=Object.values(parts).filter(Boolean).join(', ');
 if(!parts.house)throw Error('Enter House / Flat No.');
 if(line.length<8||line.length>500)throw Error('Enter a complete delivery address within 500 characters');
 return {parts,line};
}
export function readAddressParts(row){if(!row)return null;let parts=null;try{const parsed=normalizeAddressParts(JSON.parse(row.address_parts||'null'));if(parsed.line===row.address_line)parts=parsed.parts}catch{}const {address_parts,...address}=row;return {...address,parts}}
