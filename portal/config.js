/* ===================================================================
   Client space: where the logins live

   Empty means not connected yet. On localhost that switches on test
   mode (pretend accounts kept in this browser, see js/portal-auth.js).
   On the real site an empty config keeps the login closed.

   To connect: Supabase > Project Settings > API, copy the Project URL
   and the publishable (anon) key in here. The key is meant to be
   public. What a signed-in client can read is decided by the database
   rules in portal-setup/supabase.sql, not by keeping this secret.
   Never put the service_role / secret key here.
   =================================================================== */

window.HS_PORTAL = {
  supabaseUrl: "https://konlktdvtzyuhgfodyis.supabase.co",
  supabaseKey: "sb_publishable_HhC9mlXI7oNMS6HufZ2ueQ_4r6_iM84",
  /* true once Google is switched on in Supabase > Authentication > Providers */
  google: false
};
