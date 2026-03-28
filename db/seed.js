import postgres from 'postgres';
import bcrypt from 'bcrypt';

const sql = postgres(process.env.DATABASE_URL);

// ─────────────────────────────────────────────
// Guard — skip if already seeded
// ─────────────────────────────────────────────
const existing = await sql`SELECT COUNT(*) as count FROM installations`;
if (parseInt(existing[0].count) > 0) {
    console.log('Already seeded, skipping');
    await sql.end();
    process.exit(0);
}

// ─────────────────────────────────────────────
// Installations data
// ─────────────────────────────────────────────
const installations = [
    { name: 'Familie Müller', city: 'Gifhorn', lat: 52.4883, lng: 10.5444, panel_count: 20, battery_kwh: 10.0, inverter_brand: 'SMA', lease_start: '2022-03-15', monthly_lease_eur: 89 },
    { name: 'Familie Schmidt', city: 'Berlin', lat: 52.5200, lng: 13.4050, panel_count: 24, battery_kwh: 15.0, inverter_brand: 'Fronius', lease_start: '2021-06-01', monthly_lease_eur: 109 },
    { name: 'Familie Wagner', city: 'Munich', lat: 48.1351, lng: 11.5820, panel_count: 18, battery_kwh: 7.5, inverter_brand: 'SolarEdge', lease_start: '2023-01-10', monthly_lease_eur: 79 },
    { name: 'Familie Fischer', city: 'Hamburg', lat: 53.5511, lng: 9.9937, panel_count: 22, battery_kwh: 10.0, inverter_brand: 'SMA', lease_start: '2022-09-20', monthly_lease_eur: 99 },
    { name: 'Familie Weber', city: 'Frankfurt', lat: 50.1109, lng: 8.6821, panel_count: 16, battery_kwh: 7.5, inverter_brand: 'Fronius', lease_start: '2023-04-05', monthly_lease_eur: 79 },
    { name: 'Familie Meyer', city: 'Cologne', lat: 50.9333, lng: 6.9500, panel_count: 20, battery_kwh: 10.0, inverter_brand: 'SolarEdge', lease_start: '2022-07-12', monthly_lease_eur: 89 },
    { name: 'Familie Becker', city: 'Stuttgart', lat: 48.7758, lng: 9.1829, panel_count: 24, battery_kwh: 15.0, inverter_brand: 'SMA', lease_start: '2021-11-30', monthly_lease_eur: 119 },
    { name: 'Familie Hoffmann', city: 'Düsseldorf', lat: 51.2217, lng: 6.7762, panel_count: 18, battery_kwh: 10.0, inverter_brand: 'Fronius', lease_start: '2023-02-14', monthly_lease_eur: 89 },
    { name: 'Familie Schulz', city: 'Leipzig', lat: 51.3397, lng: 12.3731, panel_count: 22, battery_kwh: 12.0, inverter_brand: 'SolarEdge', lease_start: '2022-05-08', monthly_lease_eur: 99 },
    { name: 'Familie Zimmermann', city: 'Dresden', lat: 51.0504, lng: 13.7373, panel_count: 16, battery_kwh: 7.5, inverter_brand: 'SMA', lease_start: '2023-06-22', monthly_lease_eur: 79 },
];

const PANEL_KW = 0.4;
const PASSWORD_HASH = await bcrypt.hash('Test1234!', 10);

// ─────────────────────────────────────────────
// Solar output by month (avg kWh/day)
// Seasonal curve for Germany
// ─────────────────────────────────────────────
const MONTHLY_SOLAR = [5, 6, 11, 16, 22, 26, 27, 24, 17, 11, 6, 4];

function noise(pct = 0.15) {
    return 1 + (Math.random() * 2 - 1) * pct;
}

function solarForDay(date, panelCount) {
    const month = new Date(date).getMonth(); // 0–11
    const baseSolar = MONTHLY_SOLAR[month] * panelCount * PANEL_KW / 8;
    return Math.max(0, baseSolar * noise());
}

function hourlyBreakdown(solarKwh, consumptionKwh) {
    // Bell curve peaking at noon (hour 13)
    const weights = Array.from({ length: 24 }, (_, h) => {
        if (h < 5 || h > 21) return 0;
        return Math.exp(-0.5 * Math.pow((h - 13) / 3.5, 2));
    });
    const total = weights.reduce((a, b) => a + b, 0);

    return weights.map((w, hour) => ({
        hour,
        solar_wh: Math.round((w / total) * solarKwh * 1000),
        consumption_wh: Math.round((consumptionKwh * 1000) / 24),
        grid_wh: 0, // simplified
    }));
}

// ─────────────────────────────────────────────
// Insert installations + users + daily aggregates
// ─────────────────────────────────────────────
console.log('Seeding installations...');

for (let i = 0; i < installations.length; i++) {
    const inst = installations[i];

    // Insert installation
    const [{ id: installationId }] = await sql`
    INSERT INTO installations
      (name, city, lat, lng, panel_count, panel_kw, battery_kwh, inverter_brand, lease_start, monthly_lease_eur)
    VALUES
      (${inst.name}, ${inst.city}, ${inst.lat}, ${inst.lng}, ${inst.panel_count}, ${PANEL_KW},
       ${inst.battery_kwh}, ${inst.inverter_brand}, ${inst.lease_start}, ${inst.monthly_lease_eur})
    RETURNING id
  `;

    // Insert user
    const email = `kunde${i + 1}@solarhome.de`;
    await sql`
    INSERT INTO users (installation_id, email, password_hash)
    VALUES (${installationId}, ${email}, ${PASSWORD_HASH})
  `;

    console.log(`  ✓ ${inst.name} (${inst.city}) → ${email}`);

    // Insert 365 days of daily_aggregates
    const today = new Date();
    const rows = [];

    for (let d = 364; d >= 0; d--) {
        const date = new Date(today);
        date.setDate(today.getDate() - d);
        const dateStr = date.toISOString().split('T')[0];

        const solarKwh = solarForDay(dateStr, inst.panel_count);
        const consumptionKwh = (9 + Math.random() * 5) * noise(0.1);
        const surplus = Math.max(0, solarKwh - consumptionKwh);
        const deficit = Math.max(0, consumptionKwh - solarKwh);
        const gridExportKwh = Math.min(surplus, surplus * 0.6);
        const gridImportKwh = Math.min(deficit, deficit * 0.4);
        const selfSufficiency = Math.min(100, (solarKwh / consumptionKwh) * 100);
        const peakSolarW = solarKwh * 1000 / 5;

        rows.push({
            date: dateStr,
            installation_id: installationId,
            solar_kwh: parseFloat(solarKwh.toFixed(2)),
            consumption_kwh: parseFloat(consumptionKwh.toFixed(2)),
            grid_export_kwh: parseFloat(gridExportKwh.toFixed(2)),
            grid_import_kwh: parseFloat(gridImportKwh.toFixed(2)),
            battery_cycles: parseFloat((surplus / inst.battery_kwh).toFixed(2)),
            self_sufficiency_pct: parseFloat(selfSufficiency.toFixed(1)),
            peak_solar_w: parseFloat(peakSolarW.toFixed(0)),
            hourly_breakdown: JSON.stringify(hourlyBreakdown(solarKwh, consumptionKwh)),
        });
    }

    // Bulk insert in chunks of 100
    for (let c = 0; c < rows.length; c += 100) {
        const chunk = rows.slice(c, c + 100);
        await sql`INSERT INTO daily_aggregates ${sql(chunk)}`;
    }

    console.log(`  ✓ 365 days seeded for ${inst.city}`);
}

console.log('\n✅ Seed complete. 10 installations, 10 users, 3650 daily rows.');
await sql.end();