import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

// ─────────────────────────────────────────────
// In-memory state per installation
// ─────────────────────────────────────────────
const state = new Map();

// ─────────────────────────────────────────────
// Solar output factor by hour of day
// ─────────────────────────────────────────────
function solarFactor(hour) {
    if (hour < 5 || hour > 21) return 0;
    return Math.max(0, Math.exp(-0.5 * Math.pow((hour - 13) / 3.5, 2)));
}

// ─────────────────────────────────────────────
// Small random noise
// ─────────────────────────────────────────────
function noise(pct = 0.1) {
    return 1 + (Math.random() * 2 - 1) * pct;
}

// ─────────────────────────────────────────────
// Generate one reading for an installation
// ─────────────────────────────────────────────
function generateReading(installation) {
    const { id, panel_count, panel_kw, battery_kwh } = installation;
    const hour = new Date().getHours();

    // Peak watts this installation can produce
    const peakW = panel_count * panel_kw * 1000;

    // Current solar production
    const solarW = Math.round(peakW * solarFactor(hour) * noise());

    // Consumption is fairly flat with slight morning/evening peaks
    const consumptionBase = 800 + (hour >= 7 && hour <= 9 ? 600 : 0)
        + (hour >= 18 && hour <= 21 ? 800 : 0);
    const consumptionW = Math.round(consumptionBase * noise());

    // Battery state from memory
    const s = state.get(id);
    let batteryPct = s.battery_pct;

    const surplus = solarW - consumptionW;
    const batteryCapacityW = battery_kwh * 1000;

    let batteryW = 0;
    let gridW = 0;

    if (surplus > 0) {
        // Solar exceeds consumption — charge battery first
        if (batteryPct < 100) {
            batteryW = Math.min(surplus, batteryCapacityW * 0.2); // max 20% capacity per tick
            batteryPct = Math.min(100, batteryPct + (batteryW / batteryCapacityW) * 100);
        } else {
            // Battery full — export to grid
            gridW = surplus;
        }
    } else {
        // Consumption exceeds solar — discharge battery first
        const deficit = Math.abs(surplus);
        if (batteryPct > 5) {
            batteryW = -Math.min(deficit, batteryCapacityW * 0.2);
            batteryPct = Math.max(0, batteryPct + (batteryW / batteryCapacityW) * 100);
        } else {
            // Battery empty — import from grid
            gridW = -deficit;
        }
    }

    // Save updated battery state
    state.set(id, { battery_pct: batteryPct });

    return {
        time: new Date(),
        installation_id: id,
        solar_w: solarW,
        consumption_w: consumptionW,
        battery_w: Math.round(batteryW),
        battery_pct: parseFloat(batteryPct.toFixed(1)),
        grid_w: Math.round(gridW),
    };
}

// ─────────────────────────────────────────────
// Startup — load all installations
// ─────────────────────────────────────────────
console.log('Simulator starting...');

const installations = await sql`
  SELECT id, panel_count, panel_kw, battery_kwh
  FROM installations
`;

if (installations.length === 0) {
    console.error('No installations found. Did the seed run?');
    process.exit(1);
}

// Initialise battery state for each installation
for (const inst of installations) {
    state.set(inst.id, { battery_pct: 50 + Math.random() * 30 });
}

console.log(`✓ Loaded ${installations.length} installations`);
console.log('Writing readings every 5s...\n');

// ─────────────────────────────────────────────
// Main loop — every 5 seconds
// ─────────────────────────────────────────────
setInterval(async () => {
    const readings = installations.map(generateReading);

    try {
        await sql`INSERT INTO raw_readings ${sql(readings)}`;
        const hour = new Date().getHours();
        console.log(`[${new Date().toISOString()}] ✓ ${readings.length} readings written — solar factor: ${solarFactor(hour).toFixed(2)}`);
    } catch (err) {
        console.error('Insert failed:', err.message);
    }
}, 5000);