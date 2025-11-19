// MUST BE FIRST LINE - Load environment variables
require('dotenv').config();

// scraper.js - LinkedIn Avaloq Candidate Scraper
// Uses Google Custom Search API to avoid LinkedIn blocking

const axios = require('axios');
const Airtable = require('airtable');

// Configuration from environment variables
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Candidates';

// Validate required environment variables
if (!AIRTABLE_TOKEN) {
  console.error('ERROR: AIRTABLE_TOKEN is not set in .env file');
  process.exit(1);
}

if (!AIRTABLE_BASE_ID) {
  console.error('ERROR: AIRTABLE_BASE_ID is not set in .env file');
  process.exit(1);
}

if (!GOOGLE_API_KEY) {
  console.error('ERROR: GOOGLE_API_KEY is not set in .env file');
  process.exit(1);
}

if (!GOOGLE_CSE_ID) {
  console.error('ERROR: GOOGLE_CSE_ID is not set in .env file');
  process.exit(1);
}

// Initialize Airtable
const base = new Airtable({ apiKey: AIRTABLE_TOKEN }).base(AIRTABLE_BASE_ID);

// Countries to search
const COUNTRIES = ['Singapore', 'Malaysia', 'Philippines'];

// Avaloq keyword variations
const AVALOQ_KEYWORDS = [
  'Avaloq developer',
  'Avaloq consultant',
  'Avaloq specialist',
  'Avaloq engineer',
  'Avaloq architect'
];

// Avaloq modules for keyword detection
const AVALOQ_MODULES = {
  'Investment Transactions': ['investment', 'transaction', 'trading', 'portfolio'],
  'Cash Management': ['cash', 'liquidity', 'treasury', 'payment'],
  'Client Management': ['client', 'CRM', 'relationship', 'onboarding'],
  'Interfaces': ['interface', 'integration', 'API', 'middleware'],
  'Reporting': ['reporting', 'analytics', 'dashboard', 'BI'],
  'Custody': ['custody', 'settlement', 'safekeeping'],
  'Corporate Actions': ['corporate action', 'dividend', 'split', 'merger']
};

// Rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function searchGoogle(keyword, country, startIndex = 1) {
  const query = `site:linkedin.com/in ${keyword} ${country}`;
  
  try {
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: GOOGLE_API_KEY,
        cx: GOOGLE_CSE_ID,
        q: query,
        num: 10,
        start: startIndex
      },
      timeout: 10000
    });
    
    return response.data.items || [];
  } catch (error) {
    if (error.response) {
      console.error(`Google Search API error for "${query}": ${error.response.status} - ${error.response.data.error?.message || 'Unknown error'}`);
    } else {
      console.error(`Google Search API error for "${query}":`, error.message);
    }
    return [];
  }
}

function parseSearchResult(item, country) {
  const title = item.title || '';
  const snippet = item.snippet || '';
  const link = item.link || '';
  
  console.log('\n--- DEBUG: Raw Search Result ---');
  console.log('Title:', title);
  console.log('Snippet:', snippet.substring(0, 200));
  console.log('--------------------------------\n');
  
  let name = 'Unknown';
  const nameParts = title.split(/\s*[-|]\s*/);
  if (nameParts.length > 0) {
    name = nameParts[0].trim().replace(/\s*\(.*?\)\s*/g, '');
  }
  
  let currentRole = 'Not specified';
  let company = 'Not specified';

  const cleanTitle = title.replace(/\s*[-|]\s*LinkedIn.*$/i, '').trim();
  const titleParts = cleanTitle.split(/\s*[-|]\s*/);
  console.log('Title parts:', titleParts);
  
  if (titleParts.length >= 2) {
    const afterName = titleParts.slice(1).join(' | ');
    const atPattern = /^(.+?)\s+(?:at|@)\s+(.+)$/i;
    const atMatch = afterName.match(atPattern);
    
    if (atMatch) {
      currentRole = atMatch[1].trim();
      company = atMatch[2].trim();
      console.log('Extracted from title with at:', { currentRole, company });
    } else {
      if (titleParts.length === 3) {
        currentRole = titleParts[1].trim();
        company = titleParts[2].trim();
        console.log('Extracted from title (3 parts):', { currentRole, company });
      } else if (titleParts.length === 2) {
        currentRole = titleParts[1].trim();
        console.log('Extracted role from title (no company):', { currentRole });
      }
    }
  }
  
  if (currentRole === 'Not specified' || company === 'Not specified') {
    const currentlyPattern = /(?:Current(?:ly)?|Experience)[:\s]+([^\.·\n]+?)(?:\s+(?:at|@)\s+([^\.·\n]+?))?(?:\.|·|$)/i;
    const currentMatch = snippet.match(currentlyPattern);
    
    if (currentMatch) {
      if (currentRole === 'Not specified' && currentMatch[1]) {
        currentRole = currentMatch[1].trim();
        console.log('Extracted role from snippet Current:', currentRole);
      }
      if (company === 'Not specified' && currentMatch[2]) {
        company = currentMatch[2].trim();
        console.log('Extracted company from snippet Current:', company);
      }
    }
    
    if (company === 'Not specified') {
      const atCompanyPattern = /\b(?:at|@)\s+([A-Z][A-Za-z\s&]+?)(?:\s*[·•\.]|\s+in\s+|\s+\d|\s*$)/;
      const companyMatch = snippet.match(atCompanyPattern);
      if (companyMatch) {
        company = companyMatch[1].trim();
        console.log('Extracted company from snippet at:', company);
      }
    }
  }
  
  if (currentRole === 'Not specified') {
    const roleKeywords = ['developer', 'engineer', 'consultant', 'architect', 'specialist', 'analyst', 'manager', 'lead'];
    const snippetLower = snippet.toLowerCase();
    
    for (const keyword of roleKeywords) {
      if (snippetLower.includes(keyword)) {
        const pattern = new RegExp(`([A-Z][a-z]+\\s+)*${keyword}(?:\\s+[A-Z][a-z]+)*`, 'i');
        const match = snippet.match(pattern);
        if (match) {
          currentRole = match[0].trim();
          console.log('Extracted role from keyword match:', currentRole);
          break;
        }
      }
    }
  }
  
  currentRole = currentRole
    .replace(/\s*[·•]\s*.*$/g, '')
    .replace(/\s+\d+\s*(?:\+)?\s*(?:years?|yrs?|connections?|followers?).*/gi, '')
    .replace(/\s+in\s+(?:Singapore|Malaysia|Philippines).*/gi, '')
    .replace(/(?:Singapore|Malaysia|Philippines|University|See your|View|mutual|connections?|followers?).*/gi, '')
    .replace(/[,;]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  
  company = company
    .replace(/\s*[·•]\s*.*$/g, '')
    .replace(/\s+\d+\s*(?:\+)?\s*(?:years?|yrs?|connections?|followers?).*/gi, '')
    .replace(/\s+in\s+(?:Singapore|Malaysia|Philippines).*/gi, '')
    .replace(/(?:Singapore|Malaysia|Philippines|University|See your|View|mutual|connections?|followers?).*/gi, '')
    .replace(/[,;]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  
  if (currentRole.length > 80) {
    currentRole = currentRole.substring(0, 80).trim();
  }
  if (currentRole.length < 3 || /^\d+$/.test(currentRole)) {
    currentRole = 'Not specified';
  }
  
  if (company.length > 80) {
    company = company.substring(0, 80).trim();
  }
  if (company.length < 2 || /^\d+$/.test(company)) {
    company = 'Not specified';
  }
  
  console.log('Final extraction:', { name, currentRole, company });
  
  const detectedKeywords = [];
  const combinedText = (title + ' ' + snippet).toLowerCase();
  
  for (const [module, keywords] of Object.entries(AVALOQ_MODULES)) {
    if (keywords.some(kw => combinedText.includes(kw.toLowerCase()))) {
      detectedKeywords.push(module);
    }
  }
  
  let yearsOfExperience = null;
  
  const yearPatterns = [
    /(\d+)\+?\s*years?\s+(?:of\s+)?experience/i,
    /experience[:\s]+(\d+)\+?\s*years?/i,
    /(\d+)\+?\s*years?\s+in\s+Avaloq/i,
    /(\d+)\+?\s*yrs?\s+experience/i,
    /over\s+(\d+)\s+years?/i
  ];
  
  for (const pattern of yearPatterns) {
    const match = combinedText.match(pattern);
    if (match) {
      yearsOfExperience = parseInt(match[1]);
      break;
    }
  }
  
  if (yearsOfExperience === null) {
    if (combinedText.includes('junior') || combinedText.includes('graduate') || combinedText.includes('entry')) {
      yearsOfExperience = 1;
    } else if (combinedText.includes('senior') || combinedText.includes('lead developer')) {
      yearsOfExperience = 8;
    } else if (combinedText.includes('principal') || combinedText.includes('architect') || combinedText.includes('head of')) {
      yearsOfExperience = 12;
    } else if (combinedText.includes('manager') || combinedText.includes('director')) {
      yearsOfExperience = 10;
    } else if (combinedText.includes('engineer') || combinedText.includes('developer') || combinedText.includes('consultant')) {
      yearsOfExperience = 5;
    }
  }
  
  return {
    Name: name,
    'LinkedIn URL': link,
    Location: country,
    'Current Role': currentRole,
    'Company': company,
    'Avaloq Keywords': detectedKeywords.length > 0 ? detectedKeywords : ['General Avaloq'],
    'Years of Experience': yearsOfExperience,
    Source: 'LinkedIn Automation',
    'Date Added': new Date().toISOString().split('T')[0],
    Status: 'New'
  };
}

async function getFirstEmptyRow() {
  try {
    const records = await base(AIRTABLE_TABLE_NAME)
      .select({
        fields: ['Name'],
        sort: [{field: 'Name', direction: 'asc'}]
      })
      .all();
    
    for (let i = 0; i < records.length; i++) {
      if (!records[i].fields.Name || records[i].fields.Name.trim() === '') {
        return records[i].id;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding empty row:', error.message);
    return null;
  }
}

async function candidateExists(linkedinUrl) {
  try {
    const records = await base(AIRTABLE_TABLE_NAME)
      .select({
        filterByFormula: `{LinkedIn URL} = "${linkedinUrl}"`,
        maxRecords: 1
      })
      .firstPage();
    
    return records.length > 0;
  } catch (error) {
    console.error('Error checking candidate existence:', error.message);
    return false;
  }
}

async function addCandidate(candidate) {
  try {
    if (await candidateExists(candidate['LinkedIn URL'])) {
      console.log(`Skipping duplicate: ${candidate.Name}`);
      return false;
    }
    
    const emptyRowId = await getFirstEmptyRow();
    
    if (emptyRowId) {
      await base(AIRTABLE_TABLE_NAME).update([
        {
          id: emptyRowId,
          fields: candidate
        }
      ]);
      console.log(`Updated empty row with: ${candidate.Name}`);
    } else {
      await base(AIRTABLE_TABLE_NAME).create([
        { fields: candidate }
      ]);
      console.log(`Created new row for: ${candidate.Name}`);
    }
    
    const yearsText = candidate['Years of Experience'] 
      ? `${candidate['Years of Experience']} years` 
      : 'experience unknown';
    const companyText = candidate['Company'] !== 'Not specified' 
      ? `at ${candidate['Company']}` 
      : '';
    console.log(`   ${candidate['Current Role']} ${companyText} (${yearsText}) - ${candidate.Location}`);
    return true;
  } catch (error) {
    console.error(`Failed to add ${candidate.Name}:`, error.message);
    return false;
  }
}

async function runScraper() {
  console.log('Avaloq Candidate Scraper Started');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');
  
  let totalAdded = 0;
  let totalFound = 0;
  let totalDuplicates = 0;
  
  for (const country of COUNTRIES) {
    console.log(`\nSearching: ${country}`);
    
    for (const keyword of AVALOQ_KEYWORDS) {
      console.log(`  Keyword: "${keyword}"`);
      
      const results = await searchGoogle(keyword, country, 1);
      totalFound += results.length;
      
      if (results.length === 0) {
        console.log(`  No results found`);
      } else {
        console.log(`  Found ${results.length} results`);
      }
      
      for (const result of results) {
        const candidate = parseSearchResult(result, country);
        const added = await addCandidate(candidate);
        if (added) {
          totalAdded++;
        } else {
          totalDuplicates++;
        }
        
        await delay(2000);
      }
      
      await delay(5000);
    }
  }
  
  console.log('');
  console.log('Scraper Completed');
  console.log(`Total candidates found:    ${totalFound}`);
  console.log(`New candidates added:      ${totalAdded}`);
  console.log(`Duplicates skipped:        ${totalDuplicates}`);
  console.log(`Completion time:           ${new Date().toISOString()}`);
  console.log('');
  
  return {
    success: true,
    totalFound,
    totalAdded,
    totalDuplicates,
    timestamp: new Date().toISOString()
  };
}

module.exports = { runScraper };

if (require.main === module) {
  runScraper()
    .then(result => {
      console.log('Scraper finished successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error.message);
      process.exit(1);
    });
}