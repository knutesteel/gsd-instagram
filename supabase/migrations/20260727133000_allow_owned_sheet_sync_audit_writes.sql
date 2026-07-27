create policy "users create their sheet sync runs"
  on public.sheet_sync_runs for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users update their sheet sync runs"
  on public.sheet_sync_runs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "users create their sheet sync items"
  on public.sheet_sync_items for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users update their sheet sync items"
  on public.sheet_sync_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
