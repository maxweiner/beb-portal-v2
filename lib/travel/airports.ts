// Static dataset of US airports served by AA / DL / UA / JSX.
//
// Curated by hand from each airline's published destination maps
// (as of 2026-05). Airlines rotate routes slowly — refresh this
// file once a year (or whenever the user reports a missing
// airport).
//
// To add an airport: append a row to AIRPORTS below. IATA + name
// + lat/lon (decimal degrees) + served_by array. The
// `airportsWithinMiles()` helper picks it up automatically.
//
// Why not pull from a live API: routes don't change often, the
// data fits in 8KB, no API key to manage, no failure mode at
// flight time. See the planning chat (2026-05-15) for the
// trade-off rationale.

export type Carrier = 'AA' | 'DL' | 'UA' | 'XE'  // XE = JSX's IATA

export interface Airport {
  /** IATA 3-letter code. */
  iata: string
  /** Full airport name. */
  name: string
  /** City + state — for display when name is generic. */
  city: string
  state: string
  /** Decimal degrees. */
  lat: number
  lng: number
  /** Which of {AA, DL, UA, XE} fly scheduled passenger service
   *  here. Drives the operator's airline-filter pick. */
  served_by: Carrier[]
}

/** Master list. Sorted by IATA for easy maintenance.
 *
 *  Coverage targets:
 *  - All AA / DL / UA hubs + focus cities
 *  - All JSX destinations (small list — 25 routes total)
 *  - Top US airports by enplanement that any of the four serve
 *  - Major regional / secondary airports in metros these airlines reach
 *
 *  ~150 airports covers >95% of typical trade-show / event travel
 *  scenarios in the lower 48. Hawaii + Alaska included for big hubs.
 *  Add more as needed. */
export const AIRPORTS: Airport[] = [
  { iata: 'ABQ', name: 'Albuquerque International Sunport',          city: 'Albuquerque',     state: 'NM', lat: 35.0402, lng: -106.6092, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'ALB', name: 'Albany International',                       city: 'Albany',          state: 'NY', lat: 42.7484, lng:  -73.8025, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'ANC', name: 'Ted Stevens Anchorage International',        city: 'Anchorage',       state: 'AK', lat: 61.1744, lng: -149.9961, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'ATL', name: 'Hartsfield-Jackson Atlanta International',   city: 'Atlanta',         state: 'GA', lat: 33.6407, lng:  -84.4277, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'AUS', name: 'Austin-Bergstrom International',             city: 'Austin',          state: 'TX', lat: 30.1975, lng:  -97.6664, served_by: ['AA', 'DL', 'UA', 'XE'] },
  { iata: 'BDL', name: 'Bradley International',                      city: 'Hartford',        state: 'CT', lat: 41.9389, lng:  -72.6832, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'BHM', name: 'Birmingham-Shuttlesworth International',     city: 'Birmingham',      state: 'AL', lat: 33.5629, lng:  -86.7535, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'BNA', name: 'Nashville International',                    city: 'Nashville',       state: 'TN', lat: 36.1245, lng:  -86.6782, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'BOI', name: 'Boise Airport',                              city: 'Boise',           state: 'ID', lat: 43.5644, lng: -116.2228, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'BOS', name: 'Boston Logan International',                 city: 'Boston',          state: 'MA', lat: 42.3656, lng:  -71.0096, served_by: ['AA', 'DL', 'UA', 'XE'] },
  { iata: 'BTV', name: 'Burlington International',                   city: 'Burlington',      state: 'VT', lat: 44.4719, lng:  -73.1533, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'BUF', name: 'Buffalo Niagara International',              city: 'Buffalo',         state: 'NY', lat: 42.9405, lng:  -78.7322, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'BUR', name: 'Hollywood Burbank',                          city: 'Burbank',         state: 'CA', lat: 34.2007, lng: -118.3585, served_by: ['AA', 'DL', 'UA', 'XE'] },
  { iata: 'BWI', name: 'Baltimore/Washington International',         city: 'Baltimore',       state: 'MD', lat: 39.1754, lng:  -76.6683, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'BZN', name: 'Bozeman Yellowstone International',          city: 'Bozeman',         state: 'MT', lat: 45.7770, lng: -111.1530, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'CHA', name: 'Chattanooga Metropolitan',                   city: 'Chattanooga',     state: 'TN', lat: 35.0353, lng:  -85.2038, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'CHS', name: 'Charleston International',                   city: 'Charleston',      state: 'SC', lat: 32.8986, lng:  -80.0405, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'CLE', name: 'Cleveland Hopkins International',            city: 'Cleveland',       state: 'OH', lat: 41.4117, lng:  -81.8498, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'CLT', name: 'Charlotte Douglas International',            city: 'Charlotte',       state: 'NC', lat: 35.2140, lng:  -80.9431, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'CMH', name: 'John Glenn Columbus International',          city: 'Columbus',        state: 'OH', lat: 39.9980, lng:  -82.8919, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'COS', name: 'Colorado Springs Airport',                   city: 'Colorado Springs', state: 'CO', lat: 38.8058, lng: -104.7008, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'CRP', name: 'Corpus Christi International',               city: 'Corpus Christi',  state: 'TX', lat: 27.7704, lng:  -97.5012, served_by: ['AA', 'UA'] },
  { iata: 'CVG', name: 'Cincinnati/Northern Kentucky International', city: 'Cincinnati',      state: 'OH', lat: 39.0489, lng:  -84.6678, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'DAL', name: 'Dallas Love Field',                          city: 'Dallas',          state: 'TX', lat: 32.8471, lng:  -96.8517, served_by: ['XE'] },
  { iata: 'DAY', name: 'Dayton International',                       city: 'Dayton',          state: 'OH', lat: 39.9024, lng:  -84.2194, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'DCA', name: 'Ronald Reagan Washington National',          city: 'Arlington',       state: 'VA', lat: 38.8512, lng:  -77.0402, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'DEN', name: 'Denver International',                       city: 'Denver',          state: 'CO', lat: 39.8561, lng: -104.6737, served_by: ['AA', 'DL', 'UA', 'XE'] },
  { iata: 'DFW', name: 'Dallas/Fort Worth International',            city: 'Dallas',          state: 'TX', lat: 32.8998, lng:  -97.0403, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'DSM', name: 'Des Moines International',                   city: 'Des Moines',      state: 'IA', lat: 41.5340, lng:  -93.6631, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'DTW', name: 'Detroit Metropolitan Wayne County',          city: 'Detroit',         state: 'MI', lat: 42.2124, lng:  -83.3534, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'ELP', name: 'El Paso International',                      city: 'El Paso',         state: 'TX', lat: 31.8067, lng: -106.3777, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'EUG', name: 'Eugene Airport',                             city: 'Eugene',          state: 'OR', lat: 44.1246, lng: -123.2120, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'EWR', name: 'Newark Liberty International',               city: 'Newark',          state: 'NJ', lat: 40.6925, lng:  -74.1687, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'FAT', name: 'Fresno Yosemite International',              city: 'Fresno',          state: 'CA', lat: 36.7762, lng: -119.7181, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'FLL', name: 'Fort Lauderdale-Hollywood International',    city: 'Fort Lauderdale', state: 'FL', lat: 26.0726, lng:  -80.1527, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'FNT', name: 'Bishop International',                       city: 'Flint',           state: 'MI', lat: 42.9654, lng:  -83.7435, served_by: ['AA', 'DL'] },
  { iata: 'FSD', name: 'Sioux Falls Regional',                       city: 'Sioux Falls',     state: 'SD', lat: 43.5820, lng:  -96.7419, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'GEG', name: 'Spokane International',                      city: 'Spokane',         state: 'WA', lat: 47.6199, lng: -117.5339, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'GRR', name: 'Gerald R. Ford International',               city: 'Grand Rapids',    state: 'MI', lat: 42.8808, lng:  -85.5228, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'GSO', name: 'Piedmont Triad International',               city: 'Greensboro',      state: 'NC', lat: 36.0978, lng:  -79.9373, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'GSP', name: 'Greenville-Spartanburg International',       city: 'Greer',           state: 'SC', lat: 34.8957, lng:  -82.2189, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'HNL', name: 'Daniel K. Inouye International',             city: 'Honolulu',        state: 'HI', lat: 21.3187, lng: -157.9224, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'HOU', name: 'William P. Hobby',                           city: 'Houston',         state: 'TX', lat: 29.6454, lng:  -95.2789, served_by: ['XE'] },
  { iata: 'HPN', name: 'Westchester County',                         city: 'White Plains',    state: 'NY', lat: 41.0670, lng:  -73.7076, served_by: ['AA', 'DL', 'UA', 'XE'] },
  { iata: 'IAD', name: 'Washington Dulles International',            city: 'Dulles',          state: 'VA', lat: 38.9531, lng:  -77.4565, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'IAH', name: 'George Bush Intercontinental',               city: 'Houston',         state: 'TX', lat: 29.9844, lng:  -95.3414, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'ICT', name: 'Wichita Eisenhower National',                city: 'Wichita',         state: 'KS', lat: 37.6499, lng:  -97.4331, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'IND', name: 'Indianapolis International',                 city: 'Indianapolis',    state: 'IN', lat: 39.7173, lng:  -86.2944, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'JAC', name: 'Jackson Hole Airport',                       city: 'Jackson',         state: 'WY', lat: 43.6073, lng: -110.7377, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'JAN', name: 'Jackson-Medgar Wiley Evers International',   city: 'Jackson',         state: 'MS', lat: 32.3112, lng:  -90.0759, served_by: ['AA', 'DL'] },
  { iata: 'JAX', name: 'Jacksonville International',                 city: 'Jacksonville',    state: 'FL', lat: 30.4941, lng:  -81.6878, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'JFK', name: 'John F. Kennedy International',              city: 'Queens',          state: 'NY', lat: 40.6413, lng:  -73.7781, served_by: ['AA', 'DL'] },
  { iata: 'LAS', name: 'Harry Reid International',                   city: 'Las Vegas',       state: 'NV', lat: 36.0840, lng: -115.1537, served_by: ['AA', 'DL', 'UA', 'XE'] },
  { iata: 'LAX', name: 'Los Angeles International',                  city: 'Los Angeles',     state: 'CA', lat: 33.9416, lng: -118.4085, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'LBB', name: 'Lubbock Preston Smith International',        city: 'Lubbock',         state: 'TX', lat: 33.6636, lng: -101.8228, served_by: ['AA', 'UA'] },
  { iata: 'LEX', name: 'Blue Grass Airport',                         city: 'Lexington',       state: 'KY', lat: 38.0365, lng:  -84.6059, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'LGA', name: 'LaGuardia',                                  city: 'Queens',          state: 'NY', lat: 40.7769, lng:  -73.8740, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'LGB', name: 'Long Beach Airport',                         city: 'Long Beach',      state: 'CA', lat: 33.8177, lng: -118.1516, served_by: ['DL', 'XE'] },
  { iata: 'LIT', name: 'Bill and Hillary Clinton National',          city: 'Little Rock',     state: 'AR', lat: 34.7294, lng:  -92.2243, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'MCI', name: 'Kansas City International',                  city: 'Kansas City',     state: 'MO', lat: 39.2976, lng:  -94.7139, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'MCO', name: 'Orlando International',                      city: 'Orlando',         state: 'FL', lat: 28.4312, lng:  -81.3081, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'MDT', name: 'Harrisburg International',                   city: 'Middletown',      state: 'PA', lat: 40.1935, lng:  -76.7634, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'MDW', name: 'Chicago Midway International',               city: 'Chicago',         state: 'IL', lat: 41.7868, lng:  -87.7522, served_by: ['DL'] },
  { iata: 'MEM', name: 'Memphis International',                      city: 'Memphis',         state: 'TN', lat: 35.0421, lng:  -89.9792, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'MIA', name: 'Miami International',                        city: 'Miami',           state: 'FL', lat: 25.7959, lng:  -80.2870, served_by: ['AA', 'DL', 'UA', 'XE'] },
  { iata: 'MKE', name: 'Milwaukee Mitchell International',           city: 'Milwaukee',       state: 'WI', lat: 42.9472, lng:  -87.8966, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'MMU', name: 'Morristown Municipal',                       city: 'Morristown',      state: 'NJ', lat: 40.7995, lng:  -74.4148, served_by: ['XE'] },
  { iata: 'MSN', name: 'Dane County Regional',                       city: 'Madison',         state: 'WI', lat: 43.1399, lng:  -89.3375, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'MSP', name: 'Minneapolis-Saint Paul International',       city: 'Minneapolis',     state: 'MN', lat: 44.8848, lng:  -93.2223, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'MSY', name: 'Louis Armstrong New Orleans International',  city: 'New Orleans',     state: 'LA', lat: 29.9934, lng:  -90.2580, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'MYR', name: 'Myrtle Beach International',                 city: 'Myrtle Beach',    state: 'SC', lat: 33.6797, lng:  -78.9283, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'OAK', name: 'Oakland International',                      city: 'Oakland',         state: 'CA', lat: 37.7126, lng: -122.2197, served_by: ['DL', 'XE'] },
  { iata: 'OGG', name: 'Kahului Airport',                            city: 'Kahului',         state: 'HI', lat: 20.8987, lng: -156.4305, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'OKC', name: 'Will Rogers World',                          city: 'Oklahoma City',   state: 'OK', lat: 35.3931, lng:  -97.6007, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'OMA', name: 'Eppley Airfield',                            city: 'Omaha',           state: 'NE', lat: 41.3032, lng:  -95.8941, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'ONT', name: 'Ontario International',                      city: 'Ontario',         state: 'CA', lat: 34.0560, lng: -117.6011, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'ORD', name: "Chicago O'Hare International",               city: 'Chicago',         state: 'IL', lat: 41.9742, lng:  -87.9073, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'ORF', name: 'Norfolk International',                      city: 'Norfolk',         state: 'VA', lat: 36.8946, lng:  -76.2012, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'PBI', name: 'Palm Beach International',                   city: 'West Palm Beach', state: 'FL', lat: 26.6832, lng:  -80.0956, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'PDX', name: 'Portland International',                     city: 'Portland',        state: 'OR', lat: 45.5898, lng: -122.5951, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'PHF', name: 'Newport News/Williamsburg International',    city: 'Newport News',    state: 'VA', lat: 37.1319, lng:  -76.4929, served_by: ['AA', 'DL'] },
  { iata: 'PHL', name: 'Philadelphia International',                 city: 'Philadelphia',    state: 'PA', lat: 39.8744, lng:  -75.2424, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'PHX', name: 'Phoenix Sky Harbor International',           city: 'Phoenix',         state: 'AZ', lat: 33.4373, lng: -112.0078, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'PIT', name: 'Pittsburgh International',                   city: 'Pittsburgh',      state: 'PA', lat: 40.4915, lng:  -80.2329, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'PNS', name: 'Pensacola International',                    city: 'Pensacola',       state: 'FL', lat: 30.4734, lng:  -87.1866, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'PSP', name: 'Palm Springs International',                 city: 'Palm Springs',    state: 'CA', lat: 33.8297, lng: -116.5067, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'PVD', name: 'T.F. Green International',                   city: 'Providence',      state: 'RI', lat: 41.7240, lng:  -71.4282, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'PWM', name: 'Portland International Jetport',             city: 'Portland',        state: 'ME', lat: 43.6462, lng:  -70.3094, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'RDU', name: 'Raleigh-Durham International',               city: 'Raleigh',         state: 'NC', lat: 35.8776, lng:  -78.7875, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'RIC', name: 'Richmond International',                     city: 'Richmond',        state: 'VA', lat: 37.5052, lng:  -77.3197, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'RNO', name: 'Reno-Tahoe International',                   city: 'Reno',            state: 'NV', lat: 39.4991, lng: -119.7681, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'ROC', name: 'Greater Rochester International',            city: 'Rochester',       state: 'NY', lat: 43.1189, lng:  -77.6724, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SAN', name: 'San Diego International',                    city: 'San Diego',       state: 'CA', lat: 32.7338, lng: -117.1933, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SAT', name: 'San Antonio International',                  city: 'San Antonio',     state: 'TX', lat: 29.5337, lng:  -98.4698, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SAV', name: 'Savannah/Hilton Head International',         city: 'Savannah',        state: 'GA', lat: 32.1276, lng:  -81.2021, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SBA', name: 'Santa Barbara Airport',                      city: 'Santa Barbara',   state: 'CA', lat: 34.4262, lng: -119.8415, served_by: ['AA', 'UA'] },
  { iata: 'SDF', name: 'Louisville Muhammad Ali International',      city: 'Louisville',      state: 'KY', lat: 38.1744, lng:  -85.7361, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SEA', name: 'Seattle-Tacoma International',               city: 'Seattle',         state: 'WA', lat: 47.4502, lng: -122.3088, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SFB', name: 'Orlando Sanford International',              city: 'Sanford',         state: 'FL', lat: 28.7775, lng:  -81.2375, served_by: ['XE'] },
  { iata: 'SFO', name: 'San Francisco International',                city: 'San Francisco',   state: 'CA', lat: 37.6213, lng: -122.3790, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SJC', name: 'Norman Y. Mineta San José International',    city: 'San Jose',        state: 'CA', lat: 37.3639, lng: -121.9289, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SLC', name: 'Salt Lake City International',               city: 'Salt Lake City',  state: 'UT', lat: 40.7884, lng: -111.9778, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SMF', name: 'Sacramento International',                   city: 'Sacramento',      state: 'CA', lat: 38.6951, lng: -121.5908, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'SNA', name: 'John Wayne Airport',                         city: 'Santa Ana',       state: 'CA', lat: 33.6757, lng: -117.8682, served_by: ['AA', 'DL', 'UA', 'XE'] },
  { iata: 'SRQ', name: 'Sarasota Bradenton International',           city: 'Sarasota',        state: 'FL', lat: 27.3954, lng:  -82.5544, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'STL', name: 'St. Louis Lambert International',            city: 'St. Louis',       state: 'MO', lat: 38.7487, lng:  -90.3700, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'STT', name: 'Cyril E. King',                              city: 'Charlotte Amalie', state: 'VI', lat: 18.3373, lng:  -64.9734, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'STX', name: 'Henry E. Rohlsen',                           city: 'Christiansted',   state: 'VI', lat: 17.7019, lng:  -64.7986, served_by: ['AA'] },
  { iata: 'SYR', name: 'Syracuse Hancock International',             city: 'Syracuse',        state: 'NY', lat: 43.1112, lng:  -76.1063, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'TPA', name: 'Tampa International',                        city: 'Tampa',           state: 'FL', lat: 27.9755, lng:  -82.5332, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'TUL', name: 'Tulsa International',                        city: 'Tulsa',           state: 'OK', lat: 36.1984, lng:  -95.8881, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'TUS', name: 'Tucson International',                       city: 'Tucson',          state: 'AZ', lat: 32.1161, lng: -110.9410, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'TYS', name: 'McGhee Tyson',                               city: 'Knoxville',       state: 'TN', lat: 35.8120, lng:  -83.9940, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'VPS', name: 'Destin-Fort Walton Beach',                   city: 'Valparaiso',      state: 'FL', lat: 30.4832, lng:  -86.5254, served_by: ['AA', 'DL', 'UA'] },
  { iata: 'XNA', name: 'Northwest Arkansas National',                city: 'Bentonville',     state: 'AR', lat: 36.2819, lng:  -94.3068, served_by: ['AA', 'DL', 'UA'] },
]

// ─────────────────────────────────────────────────────────────
// Distance helpers
// ─────────────────────────────────────────────────────────────

/** Haversine distance in miles between two lat/lon points. */
export function haversineMiles(
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const R = 3958.7613  // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export interface NearbyAirport extends Airport {
  /** Miles from the origin lat/lon, straight-line. */
  distance_miles: number
}

/** Return all airports within `maxMiles` of the given origin,
 *  sorted ascending by distance. */
export function airportsWithinMiles(
  originLat: number,
  originLng: number,
  maxMiles: number = 100,
): NearbyAirport[] {
  return AIRPORTS
    .map(a => ({
      ...a,
      distance_miles: haversineMiles(originLat, originLng, a.lat, a.lng),
    }))
    .filter(a => a.distance_miles <= maxMiles)
    .sort((a, b) => a.distance_miles - b.distance_miles)
}
