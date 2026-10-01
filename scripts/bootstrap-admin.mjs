import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://lgnbeygumswhvrijimbe.supabase.co";
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable__8LNhqMZeYnrSj0HysNFwA_lfzg93G_";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const BOOTSTRAP_EMAIL = 'admin123@gmail.com';
const BOOTSTRAP_PASSWORD = 'admin123';
const BOOTSTRAP_ROLE = 'admin';

async function bootstrap() {
  console.log('=== BayWatch Operational Admin Bootstrap ===');
  console.log(`Target: ${BOOTSTRAP_EMAIL} (${BOOTSTRAP_ROLE})`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);

  if (SERVICE_ROLE_KEY) {
    console.log('Using Service Role Key for direct administrative provisioning...');
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: usersData, error: listError } = await adminClient.auth.admin.listUsers();
    if (listError) {
      console.error('Failed to list users via admin client:', listError.message);
    } else {
      const existing = usersData.users.find(u => u.email?.toLowerCase() === BOOTSTRAP_EMAIL.toLowerCase());
      if (existing) {
        console.log(`Found existing user ID: ${existing.id}. Synchronizing role to admin...`);
        const { error: updateError } = await adminClient.auth.admin.updateUserById(existing.id, {
          password: BOOTSTRAP_PASSWORD,
          app_metadata: { ...existing.app_metadata, role: BOOTSTRAP_ROLE },
          email_confirm: true
        });
        if (updateError) console.error('Error updating user:', updateError.message);
        else console.log('Successfully updated auth.users app_metadata.role = "admin"!');

        await adminClient.from('profiles').upsert({
          id: existing.id,
          name: 'Operational Administrator',
          email: BOOTSTRAP_EMAIL,
          role: BOOTSTRAP_ROLE,
          updated_at: new Date().toISOString()
        });
      } else {
        console.log('Creating new admin user...');
        const { data: created, error: createError } = await adminClient.auth.admin.createUser({
          email: BOOTSTRAP_EMAIL,
          password: BOOTSTRAP_PASSWORD,
          email_confirm: true,
          app_metadata: { role: BOOTSTRAP_ROLE },
          user_metadata: { name: 'Operational Administrator' }
        });
        if (createError) console.error('Error creating user:', createError.message);
        else console.log(`Created admin user ID: ${created.user.id}!`);
      }
    }
  } else {
    console.log('Service role key not in environment. Checking public auth endpoint...');
    const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

    const { data: signInData, error: signInErr } = await client.auth.signInWithPassword({
      email: BOOTSTRAP_EMAIL,
      password: BOOTSTRAP_PASSWORD
    });

    if (signInErr) {
      console.log(`Sign-in status: ${signInErr.message}. Attempting signup...`);
      const { data: signUpData, error: signUpErr } = await client.auth.signUp({
        email: BOOTSTRAP_EMAIL,
        password: BOOTSTRAP_PASSWORD,
        options: {
          data: { name: 'Operational Administrator' }
        }
      });
      if (signUpErr) {
        console.error('Signup error:', signUpErr.message);
      } else {
        console.log(`Registered user in auth.users! User ID: ${signUpData.user?.id}`);
      }
    } else {
      console.log(`User exists in auth.users! User ID: ${signInData.user.id}`);
      console.log('Current app_metadata:', signInData.user.app_metadata);
    }

    console.log('\n--- ONE-TIME DATABASE COMMAND ---');
    console.log('To synchronize auth.users.raw_app_meta_data.role = "admin", execute the following in your Supabase SQL Editor:');
    console.log(`
UPDATE auth.users
   SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                         || '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb
 WHERE LOWER(email) = '${BOOTSTRAP_EMAIL}';

UPDATE public.profiles
   SET role = 'admin'
 WHERE id = (SELECT id FROM auth.users WHERE LOWER(email) = '${BOOTSTRAP_EMAIL}');
`);
  }
}

bootstrap().catch(console.error);
