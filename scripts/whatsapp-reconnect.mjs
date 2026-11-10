export function createReconnect({run, onError, schedule=setTimeout}) {
 let timer=null, attempts=0, stopped=false;
 function retry(){
  if(stopped||timer!==null)return;
  const delay=Math.min(3000*2**Math.min(attempts++,7),300000);
  timer=schedule(async()=>{
   timer=null;
   if(stopped)return;
   try{await run();}catch(error){onError(error);retry();}
  },delay);
 }
 return {retry, connected(){attempts=0;}, stop(){stopped=true;}};
}
