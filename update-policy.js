const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:%21kachna%40studio%3F2020@db.dimxegxvdbrhguqpvuwe.supabase.co:5432/postgres",
  });

  try {
    await client.connect();
    
    // First, verify we can query storage.objects
    await client.query(`
      CREATE POLICY "Allow authenticated full access to client-vault" 
      ON storage.objects FOR ALL TO authenticated 
      USING (bucket_id = 'client-vault') 
      WITH CHECK (bucket_id = 'client-vault');
    `);
    
    console.log('Policy created successfully!');
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('Policy already exists.');
    } else {
      console.error('Error executing query:', err.message);
    }
  } finally {
    await client.end();
  }
}

run();
