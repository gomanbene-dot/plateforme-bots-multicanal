import fs from 'node:fs';
import {yeEducationConfig as config} from '../src/configs/ye-education.config.js';
config.supportChannel='WhatsApp (contact humain) : https://wa.me/237699872654';
config.whatsapp={number:'+237699872654',active:true,botConnected:false,mode:'human_support'};
config.systemPrompt=config.systemPrompt.replace(/WhatsApp \+237673676864 est prévu mais NON ACTIF[\s\S]*?Rester en message privé Messenger https:\/\/m\.me\/1191324310740541\./,
 'Contact de support actuel : WhatsApp +237699872654, https://wa.me/237699872654. Ce compte est personnel, actif selon le propriétaire, et le support y est humain : aucun bot WhatsApp connecté. Ne promets pas de réponse automatique ni de délai. Ne propose pas le numéro 673676864, non activé. Messenger reste disponible si la personne préfère rester ici.');
fs.writeFileSync('src/configs/ye-education.config.js','export const yeEducationConfig = '+JSON.stringify(config,null,2)+';\n');
fs.writeFileSync('supabase/functions/ye-messenger/context.ts','export const YE_CONTEXT = '+JSON.stringify(config.systemPrompt)+';\n');
if(!config.systemPrompt.includes('aucun bot WhatsApp connecté'))throw Error('contact_not_updated');
console.log('Contact humain mis à jour ; connexion IA WhatsApp non activée.');
