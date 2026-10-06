/* Worthy Products North: rep KPI targets.
 *
 * These mirror the three KPI scheduled actions already running in Odoo
 * (Settings > Technical > Scheduled Actions), so the dashboard and the weekly
 * KPI emails show the same target and the same year-to-date figure:
 *
 *   ir.cron 107  Rubin Fresh Choice KPIs Tracker   $650,000
 *   ir.cron 110  Savan Patel KPI Target Report     $350,000
 *   ir.cron 111  Naitik Trivedi KPI Target Report  $300,000
 *
 * Odoo keeps each target as a constant inside the cron's code
 * (TARGET_ANNUAL_EX_GST), not as a field. If a target changes there, change it
 * here as well.
 *
 * Basis, exactly as the emails: calendar year (1 Jan), to the last completed
 * Sunday, posted invoices less credit notes, untaxed (ex GST), company 4.
 * This is NOT the April-March finance basis used by the rest of the page.
 */
export const SERVICE_STATION_BRANDS = ['GAS', 'Mobil', 'Caltex', 'BP', 'BP 2 Go', 'Challenge'];

export const KPI_REPS = [
  {
    key: 'rubin', rep: 'Rubin Monpara', group: 'Fresh Choice', target: 650000, cron: 107,
    scope: 'Fresh Choice Otahuhu, Mangere Bridge and Flat Bush',
    customerIds: [28877, 28876, 28875],
  },
  {
    key: 'savan', rep: 'Savan Patel', group: 'Service Stations', target: 350000, cron: 110,
    scope: "Service stations on Savan's patch, plus Morrinsville Convenience",
    repFirstName: 'Savan',
    extraStoreNames: ['Benzoo Investments Ltd T/A Morrinsville Convenience'],
  },
  {
    key: 'naitik', rep: 'Naitik Trivedi', group: 'Service Stations', target: 300000, cron: 111,
    scope: 'Service stations assigned to Naitik, or invoiced by Naitik',
    repFirstName: 'Naitik',
  },
];
