export function routeMessage(msg, {allowedGroups=[], ownIds=[]}={}) {
 const jid=msg.key?.remoteJid||'';
 if(msg.key?.fromMe)return null;
 const text=(msg.message?.conversation||msg.message?.extendedTextMessage?.text||'').trim().slice(0,2000);
 if(!text)return null;
 const group=jid.endsWith('@g.us');
 if(group){
  if(!allowedGroups.includes(jid)||!msg.key.participant)return null;
  const mentions=msg.message?.extendedTextMessage?.contextInfo?.mentionedJid||[];
  if(!/^ye(?:\s|[,!:?]|$)/i.test(text)&&!mentions.some(id=>ownIds.includes(id)))return null;
 } else if(!/@(s\.whatsapp\.net|lid)$/.test(jid))return null;
 return {jid,group,text,sessionKey:group?jid+':'+msg.key.participant:jid};
}
