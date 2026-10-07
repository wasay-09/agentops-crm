import type { DealStage } from '@agentops/contracts';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { contacts, deals, notes, users } from './schema.js';

/**
 * Deterministic demo data. Contact 1 (Maya Chen) is the demo lead: an open `lead` deal and
 * a couple of notes that give an agent something to summarise.
 */

const CONTACTS: Array<[name: string, email: string, company: string, title: string, phone: string]> = [
  [
    'Maya Chen',
    'maya.chen@northwindlogistics.com',
    'Northwind Logistics',
    'VP Operations',
    '+1 415 555 0101',
  ],
  ['Daniel Okafor', 'd.okafor@brightpathhealth.com', 'BrightPath Health', 'Head of IT', '+1 312 555 0142'],
  ['Sofia Martinez', 'sofia@lumenretail.io', 'Lumen Retail', 'COO', '+1 646 555 0177'],
  [
    'James Whitaker',
    'jwhitaker@ironclad-mfg.com',
    'Ironclad Manufacturing',
    'Plant Director',
    '+1 313 555 0190',
  ],
  [
    'Priya Raman',
    'priya.raman@cobaltfin.com',
    'Cobalt Financial',
    'Director of Compliance',
    '+1 617 555 0115',
  ],
  ['Lukas Becker', 'lukas.becker@alpenfreight.de', 'Alpen Freight', 'Logistics Manager', '+49 89 5550 1234'],
  [
    'Hannah Wright',
    'hannah@greenleafgrocers.com',
    'Greenleaf Grocers',
    'Procurement Lead',
    '+1 503 555 0133',
  ],
  ['Omar Haddad', 'omar.haddad@desertsun.energy', 'DesertSun Energy', 'CTO', '+971 4 555 0188'],
  [
    'Emily Novak',
    'enovak@harborpointhotels.com',
    'Harbor Point Hotels',
    'Revenue Director',
    '+1 206 555 0164',
  ],
  ['Kenji Watanabe', 'kenji.w@sakuramobility.jp', 'Sakura Mobility', 'Product Manager', '+81 3 5550 7788'],
  [
    'Grace Thompson',
    'grace.t@summitlegal.com',
    'Summit Legal Partners',
    'Managing Partner',
    '+1 202 555 0121',
  ],
  ['Mateo Rossi', 'mateo.rossi@veloceparts.it', 'Veloce Parts', 'Supply Chain Lead', '+39 02 5550 4411'],
  ['Aisha Bello', 'aisha.bello@kanoagritech.com', 'Kano AgriTech', 'CEO', '+234 1 555 0199'],
  ['Ryan Fitzgerald', 'ryan.fitz@clearwaterbank.com', 'Clearwater Bank', 'VP Digital', '+1 704 555 0156'],
  ['Chloe Dubois', 'chloe.dubois@maisonverte.fr', 'Maison Verte', 'Head of E-commerce', '+33 1 5550 2299'],
  [
    'Victor Petrov',
    'v.petrov@polarisanalytics.com',
    'Polaris Analytics',
    'Data Platform Lead',
    '+1 512 555 0148',
  ],
  ['Nadia Karim', 'nadia.karim@crescentpharma.com', 'Crescent Pharma', 'QA Director', '+1 908 555 0172'],
  ['Tom Gallagher', 'tom@gallagherbuilders.com', 'Gallagher Builders', 'Owner', '+1 617 555 0109'],
  [
    'Isabel Santos',
    'isabel.santos@riomarfoods.com.br',
    'Rio Mar Foods',
    'Operations Manager',
    '+55 11 5550 3344',
  ],
  ['Arjun Mehta', 'arjun.mehta@stackforge.dev', 'StackForge', 'VP Engineering', '+1 650 555 0187'],
];

// [contactIndex (1-based), title, valueUsd, stage, daysAgoUpdated]
const DEALS: Array<[number, string, number, DealStage, number]> = [
  [1, 'Fleet routing platform — pilot', 48000, 'lead', 2],
  [2, 'Patient intake automation', 72000, 'qualified', 5],
  [3, 'Store ops dashboard', 36000, 'proposal', 3],
  [3, 'Inventory forecasting add-on', 18000, 'lead', 9],
  [4, 'Predictive maintenance rollout', 120000, 'proposal', 6],
  [5, 'KYC document review', 95000, 'qualified', 4],
  [6, 'EU cross-dock scheduling', 54000, 'won', 20],
  [7, 'Supplier portal', 22000, 'lost', 35],
  [8, 'Grid telemetry analytics', 150000, 'qualified', 8],
  [9, 'Dynamic pricing engine', 64000, 'proposal', 2],
  [10, 'Fleet app integration', 41000, 'lead', 1],
  [11, 'Contract review assistant', 58000, 'won', 15],
  [12, 'Parts traceability', 33000, 'qualified', 11],
  [13, 'Crop yield forecasting', 27000, 'lead', 7],
  [14, 'Customer service copilot', 110000, 'proposal', 5],
  [14, 'Fraud alert triage', 46000, 'lost', 40],
  [15, 'Product catalogue enrichment', 25000, 'won', 25],
  [16, 'Warehouse data migration', 39000, 'qualified', 12],
  [17, 'Batch record digitisation', 84000, 'proposal', 9],
  [18, 'Project estimating tool', 15000, 'lead', 3],
  [19, 'Cold-chain monitoring', 52000, 'qualified', 6],
  [20, 'Internal developer platform', 99000, 'won', 18],
  [20, 'Incident summarisation', 21000, 'lead', 1],
  [5, 'Regulatory reporting refresh', 40000, 'lost', 50],
  [9, 'Guest messaging assistant', 19000, 'lead', 4],
];

// [contactIndex, body, author, daysAgo]
const NOTES: Array<[number, string, string, number]> = [
  [
    1,
    'Intro call: Northwind runs 340 trucks across the West Coast; dispatchers re-plan routes by hand every morning.',
    'Rory Rep',
    9,
  ],
  [
    1,
    'Maya wants a 6-week pilot on the Oakland depot before committing. Budget owner is the CFO; decision expected this quarter.',
    'Rory Rep',
    4,
  ],
  [1, 'Sent the pilot proposal draft. Maya asked for a reference customer in logistics.', 'Ada Admin', 2],
  [2, 'Daniel is evaluating three vendors; security review is the main hurdle.', 'Rory Rep', 6],
  [2, 'Shared our SOC 2 report. Follow up after their IT steering meeting.', 'Rory Rep', 3],
  [3, 'Sofia liked the dashboard demo; wants per-store drill-down.', 'Ada Admin', 5],
  [3, 'Proposal sent for 40 stores. Pricing questions on the forecasting add-on.', 'Rory Rep', 3],
  [
    4,
    'James needs sign-off from corporate engineering. Very interested in vibration sensors data.',
    'Rory Rep',
    10,
  ],
  [4, 'On-site visit scheduled at the Detroit plant.', 'Ada Admin', 6],
  [5, 'Priya mentioned an audit deadline in Q1 — urgency is high.', 'Rory Rep', 7],
  [6, 'Signed. Kickoff with Lukas next Monday.', 'Ada Admin', 20],
  [7, 'Lost to an incumbent ERP add-on; revisit next fiscal year.', 'Rory Rep', 35],
  [8, 'Omar wants an architecture review with his data team.', 'Rory Rep', 8],
  [9, 'Emily asked for a revenue uplift case study from another hotel group.', 'Ada Admin', 4],
  [9, 'Proposal for dynamic pricing sent; guest messaging is a possible second deal.', 'Rory Rep', 2],
  [10, 'Kenji is early in research; send API docs.', 'Rory Rep', 1],
  [11, 'Closed-won. Grace will be a reference for legal prospects.', 'Ada Admin', 15],
  [12, 'Mateo needs Italian-language UI. Checking roadmap.', 'Rory Rep', 11],
  [13, 'Aisha met us at AgriTech Summit; small budget but strong champion.', 'Rory Rep', 7],
  [14, 'Ryan wants the copilot live before the holiday peak.', 'Ada Admin', 5],
  [14, 'Fraud triage deal lost on price.', 'Rory Rep', 40],
  [15, 'Catalogue enrichment live; Chloe happy with results.', 'Ada Admin', 25],
  [16, 'Victor prefers a phased migration; worried about downtime.', 'Rory Rep', 12],
  [17, 'Nadia requires 21 CFR Part 11 compliance details.', 'Rory Rep', 9],
  [18, 'Tom is price-sensitive; prefers monthly billing.', 'Rory Rep', 3],
  [19, 'Isabel asked about integration with their SAP instance.', 'Ada Admin', 6],
  [20, 'Arjun is a power user; expansion potential across 4 teams.', 'Ada Admin', 18],
  [20, 'New lead for incident summarisation from the SRE team.', 'Rory Rep', 1],
  [5, 'Regulatory reporting refresh lost — they built in-house.', 'Rory Rep', 50],
  [9, 'Emily forwarded the proposal to the CFO.', 'Rory Rep', 1],
];

const DAY_MS = 24 * 60 * 60 * 1000;

export async function seed(db: Db, now = new Date()): Promise<void> {
  const daysAgo = (n: number, minutes = 0) => new Date(now.getTime() - n * DAY_MS - minutes * 60_000);
  const passwordHash = await bcrypt.hash('password123', 10);

  await db.transaction(async (tx) => {
    await tx.insert(users).values([
      { email: 'admin@acme.test', name: 'Ada Admin', role: 'admin', passwordHash },
      { email: 'rep@acme.test', name: 'Rory Rep', role: 'rep', passwordHash },
    ]);

    const insertedContacts = await tx
      .insert(contacts)
      .values(
        CONTACTS.map(([name, email, company, title, phone], i) => ({
          name,
          email,
          company,
          title,
          phone,
          createdAt: daysAgo(60 - i),
          updatedAt: daysAgo(60 - i),
        })),
      )
      .returning({ id: contacts.id });
    const contactId = (idx: number) => insertedContacts[idx - 1]!.id;

    await tx.insert(deals).values(
      DEALS.map(([c, title, valueUsd, stage, ago]) => ({
        contactId: contactId(c),
        title,
        valueUsd,
        stage,
        createdAt: daysAgo(ago + 14),
        updatedAt: daysAgo(ago),
      })),
    );

    await tx.insert(notes).values(
      NOTES.map(([c, body, author, ago], i) => ({
        contactId: contactId(c),
        body,
        author,
        createdAt: daysAgo(ago, i),
      })),
    );
  });
}

export async function isEmpty(db: Db): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return (row?.n ?? 0) === 0;
}

export async function seedIfEmpty(db: Db): Promise<boolean> {
  if (!(await isEmpty(db))) return false;
  await seed(db);
  return true;
}

/** Wipes all CRM data and resets id sequences (used by tests and `db:seed --reset`). */
export async function resetAndSeed(db: Db): Promise<void> {
  await db.execute(sql`truncate table notes, deals, contacts, users restart identity cascade`);
  await seed(db);
}
