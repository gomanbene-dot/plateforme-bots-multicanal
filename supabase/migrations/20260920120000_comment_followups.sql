create or replace function public.ye_bot_claim(p_page text)
returns setof public.ye_bot_messages language plpgsql security invoker set search_path='' as $$
declare v_row public.ye_bot_messages;
begin
 perform pg_advisory_xact_lock(6123917);
 delete from public.ye_bot_messages where received_at<now()-interval '7 days';
 update public.ye_bot_messages set status='review',error_code='worker_interrupted'
 where status='processing' and processed_at<now()-interval '3 minutes';
 update public.ye_bot_messages set status='ignored',error_code='messaging_window_expired'
 where status='pending' and id not like 'comment:%' and event_at<now()-interval '23 hours';
 if (select count(*) from public.ye_bot_messages where processed_at>=date_trunc('day',now()))>=100 then return; end if;
 select * into v_row from public.ye_bot_messages q where q.status='pending' and q.page_id=p_page
 and not exists(select 1 from public.ye_bot_messages a where a.page_id=q.page_id and a.sender_id=q.sender_id and a.status='processing')
 and (select count(*) from public.ye_bot_messages a where a.page_id=q.page_id and a.sender_id=q.sender_id and a.processed_at>now()-interval '1 minute')<3
 order by received_at limit 1 for update skip locked;
 if v_row.id is null then return; end if;
 return query update public.ye_bot_messages set status='processing',processed_at=now() where id=v_row.id returning *;
end; $$;
revoke all on function public.ye_bot_claim(text) from public,anon,authenticated;
grant execute on function public.ye_bot_claim(text) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create or replace function public.ye_bot_schedule(p_token text)
returns void language plpgsql security definer set search_path='' as $function$
declare v_id uuid;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 if length(p_token)<48 then raise exception 'Invalid worker token'; end if;
 select id into v_id from vault.secrets where name='ye_bot_worker_token';
 if v_id is null then perform vault.create_secret(p_token,'ye_bot_worker_token');
 else perform vault.update_secret(v_id,p_token); end if;
 perform cron.schedule('ye-bot-pending-messages','* * * * *',$cron$
 select net.http_post(
  url:='https://fcowwopbzkmjdyhqyufw.supabase.co/functions/v1/ye-messenger/worker',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='ye_bot_worker_token')),
  body:='{}'::jsonb,timeout_milliseconds:=1000)
 where exists(select 1 from public.ye_bot_messages where status='pending' and (id like 'comment:%' or event_at>now()-interval '23 hours'))
 $cron$);
 perform cron.schedule('ye-bot-retention','20 3 * * *',$cron$
 delete from public.ye_bot_messages where received_at<now()-interval '7 days';
 $cron$);
end; $function$;
revoke all on function public.ye_bot_schedule(text) from public,anon,authenticated;
grant execute on function public.ye_bot_schedule(text) to service_role;
