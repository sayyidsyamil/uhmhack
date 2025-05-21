import { initializeDatabase, populateSampleData } from './lib/data';

async function main() {
  try {
    console.log('Initializing database...');
    await initializeDatabase();
    console.log('Database initialized successfully!');

    console.log('Populating sample data...');
    await populateSampleData();
    console.log('Sample data populated successfully!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main(); 