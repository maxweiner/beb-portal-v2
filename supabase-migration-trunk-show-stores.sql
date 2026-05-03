-- Trunk-show client stores import.
-- Source: ~/Desktop/Trunk Clients only.xlsx (snapshot 2026-05-02).
-- Kept separate from public.stores per user; columns mirror sheet 1:1
-- (we can rename later). RLS modeled on trunk_shows: admin/superadmin/
-- trunk_admin and partners read+write. Idempotent: drops and re-creates.

DROP TABLE IF EXISTS public.trunk_show_stores CASCADE;

CREATE TABLE public.trunk_show_stores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company                    text,
  trunk_shows                boolean,
  name                       text NOT NULL,
  ts_reps                    text,
  comments                   text,
  store_hours                text,
  address_1                  text,
  address_2                  text,
  city                       text,
  state                      text,
  zip                        text,
  store_phone                text,
  contact_1                  text,
  contact_2                  text,
  contact_3                  text,
  email_1                    text,
  email_2                    text,
  url                        text,
  simply_username            text,
  quo_phone_number           text,
  aframe_buying_event        boolean,
  counter_card_buying_event  boolean,
  holds                      text,
  buying_event_questionnaire text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trunk_show_stores_name_idx        ON public.trunk_show_stores (name);
CREATE INDEX trunk_show_stores_state_idx       ON public.trunk_show_stores (state);
CREATE INDEX trunk_show_stores_trunk_shows_idx ON public.trunk_show_stores (trunk_shows);

ALTER TABLE public.trunk_show_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trunk_show_stores_read ON public.trunk_show_stores;
CREATE POLICY trunk_show_stores_read ON public.trunk_show_stores
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

DROP POLICY IF EXISTS trunk_show_stores_write ON public.trunk_show_stores;
CREATE POLICY trunk_show_stores_write ON public.trunk_show_stores
  FOR ALL TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  )
  WITH CHECK (
    public.get_my_role() IN ('admin', 'superadmin', 'trunk_admin')
    OR public.is_my_partner()
  );

INSERT INTO public.trunk_show_stores (company, trunk_shows, name, ts_reps, comments, store_hours, address_1, address_2, city, state, zip, store_phone, contact_1, contact_2, contact_3, email_1, email_2, url, simply_username, quo_phone_number, aframe_buying_event, counter_card_buying_event, holds, buying_event_questionnaire) VALUES
  ('BEB', TRUE, 'Jeff Dennis Jewelers', 'Tanya', NULL, NULL, '300 Fieldstown Rd', NULL, 'Gardendale', 'AL', '35071', '(205) 631-4848', 'Jeff Dennis', NULL, NULL, 'jeffdennisjewelers@gmail.com', NULL, 'https://jeffdennisjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Osborne''s Jewelers', 'Ann', 'Wants a buy - Mitch Smith msmith@osbornesjewelers   RJO', NULL, '3502 South Memorial Pkwy', NULL, 'Huntsville', 'AL', '35801', '(256) 883-2150', 'Jerri Osborne', 'Everett Osborne', NULL, 'josborne@osbornesjewelers.com', NULL, 'www.osbornesjewelershuntsville.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'EVM Jewelers (Evermore Jewelers)', 'Tanya', NULL, NULL, '241 N College Ave', NULL, 'Fayetteville', 'AR', '27201', '(479)-287-4084', 'Ryan Malone', NULL, NULL, 'ryan@evermorejewelers.com', NULL, 'https://evmjewelers.com/', 'Evermore', NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Gregory Jewelers', 'Tanya', NULL, NULL, '1 East 6th St', NULL, 'Mtn Home', 'AR', '72653', '(870) 425-2542', 'Lori L Gregory', 'Gloria J Gregory.      gloria@gregoryjewelers.net', NULL, 'lori@gregoryjewelers.net', NULL, 'gregoryjewelers.net', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Pagan Jewelers Inc', NULL, NULL, NULL, '624 Southwest Dr', NULL, 'Jonesboro', 'AR', '72401', '(870) 932-6256', NULL, NULL, NULL, 'Christopherapagan@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Wilkerson Jewelers', 'Ann', NULL, NULL, '222 South Main Street', NULL, 'Stuttgart', 'AR', '72160', '(800) 631-1999', 'Jennifer', NULL, NULL, 'jsmith@wilkersonjewelers.com', NULL, 'wilkersonjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Barnes Fine Jewelers', NULL, NULL, NULL, '891 N Val Vista Dr #103', NULL, 'Gilbert', 'AZ', '85234', '(480) 545-8585', NULL, NULL, NULL, 'info@barnesfinejewelers.com', NULL, 'barnesfinejewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Daniel''s-Phoenix, AZ', 'Radica', NULL, NULL, 'Desert Sky Mall,', '7611 W. Thomas Rd #F016', 'Phoenix', 'AZ', '85033', '(602) 888-8890', 'Richard Kim - DM', 'Brian Cruz - Mgr', NULL, 'richard_kim@danielsjewelers.com', NULL, 'danielsjewelers.com', NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', FALSE, 'Diamond Jim''s Jewelry', NULL, 'iffy', NULL, '6005 N 16th St', NULL, 'Phoenix', 'AZ', '85016', '(602) 466-1772', 'Jim', NULL, NULL, 'Triplewin55@gmail.com', NULL, 'diamondjims4cash.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'McGuire''s Jewlers', 'Ann', NULL, NULL, '230 East Wetmore Road', NULL, 'Tucson', 'AZ', '85707', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Paul Benson Jewelers', 'Ann', 'RJO', NULL, '264 W. 32nd Street', NULL, 'Yuma', 'AZ', '85364', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Sami Fine Jewelry', 'Ann', '10 - 5', NULL, '16704 Ave of the Fountains #100', NULL, 'Fountain Hills', 'AZ', '85268', '(480) 837-8168', 'Stephenie', 'Steph2 - assistant', NULL, 'stephenie@samifinejewelry.co', NULL, 'www.samifinejewelry.com', 'sami', '(602) 560-5893', FALSE, FALSE, '10 day', NULL),
  ('BEB', TRUE, 'Setterberg Jewelers', 'Ann', NULL, NULL, '9885 W. Bell Road', NULL, 'Sun Ciry', 'AZ', '85351', '(623) 972-6130', 'kymberlee', NULL, NULL, 'Kymberlee@setterbergs.com', NULL, 'www.setterbergs.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Thigpen Jewelers', 'Ann', 'Their normal hours are 10 to 4pm M - F. FOr the event they want 10 to 5', NULL, '442 N Willmot Rd', NULL, 'Tucson', 'AZ', '85711', '(520) 886-5557', NULL, NULL, NULL, 'thigpenjewelersaz@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Ballard & Ballard Fine Jewelers', NULL, NULL, NULL, '18400 Brookhurst St', NULL, 'Fountain Valley', 'CA', '92708', '(714) 962-0088', 'Christy Ballard', NULL, NULL, 'christy@ballardgem.com', NULL, 'http://www.ballardgem.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Brax Jewelers - Laguna', 'Ann', NULL, NULL, '32411 Golden Latern St #D', NULL, 'Laguna Niguel', 'CA', '92677', '(949) 503-1889', NULL, NULL, NULL, 'sales@braxjewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Brax Jewelers - Newport', 'Ann', NULL, NULL, '3601 Jamboree Rd #15A', NULL, 'Newport Beach', 'CA', '92660', '(949) 250-9949', 'Trinity is your contact - use the sales@ email to get her.', NULL, NULL, 'sales@braxjewelers.com', NULL, 'www.braxjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Caratti Jewelers', 'Kelly', 'RJO lead', 'T-F10 - 6   S10 - 5', '2056 First Street', 'Village Square Shopping Center', 'Livermore', 'CA', '94550', '925-447-2381', 'Colin Bennett, Jr  Master Jewler', NULL, NULL, 'colinbennettjr@yahoo.com', 'info@carattijewelers.com', 'carattijewelers.com', NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', FALSE, 'Daniel''s-Carlsbad', 'Kelly', 'Daniel''s group Free newspaper called The Coast News - Carlsbad - Sue Otto  The paper features large, popular banner ads at the bottom of the front page and the bottom of page A3.  I went ahead and booked at 1 banner ad on April 17th and a double banner (Larger size banner) on Page A3.I also booked a Double Banner on Page A3 on Friday, April 11th - All for $2000   Ayne_Paz@danielsjewelers.com

Umesh Goshai
Regional District Manager
Daniel’s Jewelers
umesh_goshai@danielsjewelers.com', '11 - 6', 'Shoppes at Carlsbad', '2525 El Camino Real #231', 'Carlsbad', 'CA', '92008', '(760) 729-7924', 'adolfo_gutierrez@danielsjewelers.com', NULL, NULL, 'adolfo_gutierrez@danielsjewelers.com', NULL, 'https://www.danielsjewelers.com/', NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Daniel''s-Plaza Bonita', 'Tanya', 'Trunk Show -  they do their own Mkting', NULL, 'Westfield Plaza Bonita', '3030 Plaza Bonita Rd #2310', 'National City', 'CA', '91950', '619-470-3181', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Daniel''s-Santa Maria', 'Kelly', 'Trunk Show - they do their own Mkting  236 Raquel''s email 
raquel_pineda@danielsjewelers.com Cell number 805 956 1342 Raffy_jamgotchian@danielsjewelers.com  District manager  818 378 4733', NULL, 'Santa Maria Town Center', '141 Town Center East', 'Santa Maria', 'CA', '93454', '(805) 928-1837', 'raquel_pineda@danielsjewelers.com', NULL, 'Raffy_jamgotchian@danielsjewelers.com  District manager  818 378 4733', NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Danz Jewelers', 'Ann', NULL, NULL, '220 S School St', NULL, 'Lodi', 'CA', '95240', '(209) 368-0424', NULL, NULL, NULL, 'danzjewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'David Hayman Jewellers', 'Tanya', '10 - 5.30   Please call to RSVP 714-996-9032
Mail Service:They usually get 4000  9 x 6
Angeles Fulfillment Services
2468 E. 26th Street
Vernon, CA 90058-1214', NULL, '18250 Imperial Hwy.', NULL, 'Yorba Linda', 'CA', '92886', '(714) 996-9032', 'Jessica', NULL, NULL, 'jl_hayman@yahoo.com', NULL, 'davidhaymanjewellers.com', NULL, NULL, FALSE, FALSE, '30 day', NULL),
  ('BEB', TRUE, 'David Tishbi Jewelry', 'Tiff', NULL, NULL, '632 Montana Ave', NULL, 'Santa Monica', 'CA', '04106', '310-866-6845', 'Holly Surya-Tishbi -310-745-1887 Cell', 'David Tishbi', NULL, 'dtj90272@gmail.com', 'info@davidtishbi.com', NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Mann''s Jewelers Inc', NULL, NULL, NULL, '1347 Lincoln Ave.', NULL, 'San Jose', 'CA', '95125', '(408) 287-7858', 'Gina', NULL, NULL, 'manns1930@gmail.com', NULL, 'www.mannsdiamonds.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Sierra Moon', 'Ann', NULL, NULL, '107 Sacramento Street', NULL, 'Auburn', 'CA', '95603', '(530) 823-1965', 'Shawn', NULL, NULL, 'sierramoongoldsmiths@gmail.com', NULL, 'www.sierramoongoldsmiths.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Talisman Collection', 'Ann', NULL, NULL, '4357 Town Center Blvd', 'Ste 118', 'El Dorado Hills', 'CA', '95762', '(916) 358-5683', NULL, NULL, NULL, 'Andrea Riso - Owner', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Vail Creek', 'Tiff', NULL, NULL, '111 E Main St,', NULL, 'Turlock', 'CA', '95380', '(209) 667-4653', 'Alta (Owner): alta@vailcreek.com
Patti (Assistant): patti@vailcreek.com

There is another owner Rachel santos', NULL, NULL, 'Alta (Owner): alta@vailcreek.com
Patti (Assistant): patti@vailcreek.com', NULL, 'vailcreek.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Yarnal Jewelers', 'Ann', NULL, NULL, '4029 E. Castro Valley Blvd', NULL, 'Castro Valley', 'CA', '94552', '(510) 889-0828', 'Claire@yarnaljewelers.com  Claire', NULL, NULL, 'Claire@yarnaljewelers.com', NULL, 'https://www.yarnaljewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Amos Jewelers', 'Tanya', 'wants a buy  talk to Brendon@amosjewelry.com', NULL, '344 Main Street', NULL, 'Wray', 'CO', '80758', '970-332-433', 'Brendon Walker', NULL, NULL, 'brendon@amosjewelry.com', NULL, 'www.amosjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', FALSE, 'Classic Facets Jewelers', NULL, NULL, NULL, '942 Pearl St', NULL, 'Boulder', 'CO', '80302', '(303) 938-8851', 'Theresa Peregoy', NULL, NULL, 'gemnerd@me.com', NULL, 'classicfacets.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Castle Rocks and Jewelry', NULL, 'Wants a Buy  Tim met the owner Izzy at the maple grove store tim visited them at their store', NULL, '3990 Limelight Ave', 'Unit C', 'Castle ROck', 'CO', '80109', '7203795179.0', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Baribault Jewelers', 'Ann', '1000 5 x 7', NULL, '81 RANKIN ROAD', NULL, 'GLASTONBURY', 'CT', '06033', '(877) 633-1727', 'Raeann B. Schwartz', 'Victoria', NULL, 'raeann@baribaultjewelers.com', 'victoria@baribaultjewelers.com', 'baribaultjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'DBK Family Jewelers', 'Tiff', 'RJO   The logo file they use is dark blue and gold called artboard 13 from the file of logos', NULL, '165 East St (RT. 10)', NULL, 'Plainville', 'CT', '06062', '(860) 747-3374', 'Ted Rahaim', NULL, NULL, 'trahaim@ymail.com', NULL, 'https://dbkfamilyjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Harstans Jewelers', 'Ann', NULL, NULL, '862 Boaston Post Road', NULL, 'Guilford', 'CT', '06437', '(203) 453-4700', 'Eddy  Eddy''s phone number is 413-478-7668', NULL, NULL, 'Harstansguilford@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Nagi Jewelers', 'Ann', NULL, NULL, '828 High Ridge Rd', NULL, 'Stamford', 'CT', '06905', '(203) 964-0551', 'No contact names yet', NULL, NULL, 'hello@NAGIJewelers.com', NULL, 'nagijewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Cellini Design Jewelers.', 'Ann', NULL, NULL, '464 Boston Post Rd.', NULL, 'Orange', 'CT.', '06477', '(203) 397-8334', NULL, NULL, NULL, 'cellinijewelers@gmail.com', NULL, 'http://cellinidesignjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('LIB', FALSE, 'Anemoni Jewelers', NULL, 'Ryan Buy with LIB', NULL, '6288 Limestone Road', NULL, 'Hockesssin', 'DE', '19707', '302-234-6668', 'Ben Anemone', NULL, NULL, 'anemoni@gmail.com', NULL, 'anemonijewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', FALSE, 'EKA Jewelers', NULL, 'Lorraine said to look at 9958 and 19971 but they are 30 and 40 mins away - area has money   - they are large areas

What we did last time:  Postcard Mailing - 7323 - $2921.32
EDDMs 10,406 - $3884.20
Delaware State News - Sun, Mon, Tues Sept 8 9 10 - $1377 - full page, Full color
The Chronical - first day of the Month - $678

total price for EKA
$8860.52', NULL, '607 N Dupont Blvd', NULL, 'Milford', 'DE', '19963', '(302) 422-7138', 'Bob   ekajewelers1990@gmail.com 
Samantha Addonizio
My cell 302-554-4654
My personal email: saddonizio13@gmail.com', NULL, NULL, 'saddonizio13@gmail.com', 'ekajewelers1990@gmail.com', 'ekajewelers.com', NULL, NULL, FALSE, FALSE, 'No Hold', NULL),
  ('LIB', TRUE, 'A. Altier Jewelers', 'Tanya', 'Wants A Buy - Knows Tanya - went to school with Foster', NULL, '4615 N University Dr', NULL, 'Coral Springs', 'FL', '33067', '954-346-3335', 'debra@aaltierjewelers.com', 'Debra', NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Askew Jewelers', 'Tanya', 'Budget         
VDP $5000
Cust List 2500
Newspaper est $2500        " Tuesday – Friday
9:30 AM – 4:00 PM
 "', '2026-10-05 00:00:00', '1121 New York Ave', NULL, 'St Cloud', 'FL', '34769', '(407) 979-4727', 'Dave', 'Lisa', 'Cyndi - store Manager', 'askewjewelers@gmail.com', NULL, 'https://askewjewelers.com/', 'askew', '(689) 202-4761', FALSE, FALSE, '30 day', NULL),
  ('BEB', TRUE, 'Blue Water Jewelers', 'Tanya', NULL, NULL, '500 Anastasia Blvd', NULL, 'St. Augustine', 'FL', '32080', '(904) 829-5855', NULL, NULL, NULL, NULL, NULL, 'bluewater-jewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('LIB', FALSE, 'Cileone Jewelers', NULL, NULL, NULL, '1561 Lakefront Dr UNIT 105', NULL, 'Sarasota', 'FL', '34240', '941-351-8792', NULL, NULL, NULL, 'Joecileone@gmail.com', NULL, 'cileone.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Daniel''s - Pembrook Pines', 'Radica', 'Ruth_Olson@danielsjewelers.com - seems to be the coordinator of the Trunk shows - big wig in the company perhaps.', NULL, 'Pembrook Lakes Mall,', '11401 Pines Blvd  #874', 'Pembrook Pines', 'FL', '33026', '(754) 764-8381', 'Marlene Ramirez - DM', 'Sheila Lobo - Acting Manager', NULL, 'marlene_ramirez@danielsjewelers.com', NULL, 'http://danielsjewelers.com/', NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Dannels Jewelers', 'Tanya', NULL, NULL, '31 Ocean Reef Dr', NULL, 'Key Largo', 'FL', '33037', '305-367-4669', 'Kim Chesher', NULL, NULL, 'Dannelsjewelry@gmail.com', NULL, 'https://www.dannelsjewelryco.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', FALSE, 'Diamonds Direct', NULL, NULL, '11 - 6', '117 2nd Ave N', NULL, 'St. Petersburg', 'FL', '33701', '(727) 867-4006', 'Danielle Sanchez', NULL, NULL, 'danielle@diamondsdirect.us', NULL, 'diamondsdirect.us', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Jay''s Fine Jewelry', 'Tanya', NULL, NULL, '1625  NW St Lucie West Blvd', NULL, 'Port Saint Lucie', 'FL', '34986', '(772) 878-8134', 'Jessica - store contact.  Ana Lynch is the media contact  magnamediapartners@gmail.com', NULL, NULL, 'Jaysfinejewelry@gmail.com', NULL, 'www.jaysfinejewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'John Michael Matthews Fine Jewelry', 'Tanya', '10 - 5    1000 4 x 6   info@johnmatthewsjewelry.com', NULL, '645 Beachland Blvd', NULL, 'Vero Beach', 'FL', '32963', '(772) 234-1512', 'Victoria -   info@johnmatthewsjewelry.com', NULL, NULL, 'info@johnmatthewsjewelry.com', NULL, 'www.johnmatthewsjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Jon''s fine jewelry', 'Tanya', NULL, NULL, '215 Brevard Ave.', NULL, 'Cocoa Village', 'FL', '32922', '(321) 631-0270', 'scherri gollehon', NULL, NULL, 'scherri@jonsfinejewelry.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Maharaja''s Fine Jewelry and Gifts', 'Tanya', NULL, NULL, '105 W 23rd Street', NULL, 'Panama City', 'FL', '32405', '(850) 763-4224', 'Mohit Samtani  mohit@shopmaharajas.com
Manu  manu@shopmaharajas.com', NULL, NULL, 'mohit@shopmaharajas.com', NULL, 'https://www.shopmaharajas.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'R & N Jewelers', 'Radica', NULL, NULL, '8935 West Atlantic Blvd.', NULL, 'Coral Springs', 'FL', '33071', '(954) 971-0430', 'sales@rnjewelers.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Reflections In Gold', 'Tanya', 'Store Hours: Tue - Fri: 10:00am - 6:00pm | Sat: 10:00am - 5:00pm | Sun & Mon: Closed', NULL, '1975 South Tamiami Trail', NULL, 'Venice', 'FL', '34293', '(941) 493-1911', 'Tony - Tonydwt11@yahoo.com 
Khia Maggio - reflectionsingold@gmail', NULL, NULL, 'Contactus@reflectionsingold.com', NULL, NULL, 'reflection', NULL, FALSE, FALSE, '30 days', NULL),
  ('BEB', TRUE, 'Robison Jewelry', 'Tanya', '10 - 5 and 10 - 4   (not doing the 9.30 anymore)
Does not use the Simply book me (SBM) or QUO phone', '10 - 5 and 10 - 4   (not doing the 9.30 anymore)', '217 Centre St', NULL, 'Fernandina Beach', 'FL', '32034', '(904) 261-3635', 'Jeff, Brett and Elizabeth.  Elizabeth does the trunk shows', NULL, NULL, 'jeff-rjc@afo.net   elizabeth@robisonjewelry.com', NULL, 'www.robisonjewelry.com', NULL, NULL, FALSE, FALSE, '15 day', NULL),
  ('BEB', TRUE, 'Victoria Ashley Fine Jewelry', 'Tanya', NULL, NULL, '645 Beachland Blvd', NULL, 'Vero Beach', 'FL', '32963', '(772) 234-1512', 'victoria Kerkela    victoria@victoriaashley.us', NULL, NULL, 'info@victoriaashley.us  victoria@victoriaashley.us', NULL, 'victoriaashley.us', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('LIB', FALSE, 'Mia Jewelers', NULL, 'Not sure this is a good location for a TS', NULL, '1851 W Hillsboro Blvd', NULL, 'Deerfield Beach', 'FL', '33442', '561-420-6775', 'Andrew', 'Alexander Tselishchev', NULL, 'kulbaand@gmail.com', NULL, 'miajewelry.org', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'A & J Jewelers', NULL, NULL, NULL, '1575 Scenic Hwy, Suite 200', NULL, 'Snellville', 'GA', '30078', '(678) 344-1022', 'Amanda Williams', NULL, NULL, NULL, NULL, 'https://snellvillejeweler.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Central Jewelers', 'Tanya', NULL, NULL, '301 Main St S', NULL, 'Tifton', 'GA', '31794', '(229) 382-5345', 'John Curtis Falotico', NULL, NULL, 'falotico1977@gmail.com', NULL, 'https://centraljewelry.net/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Godwin Jewelers - Bainbridge GA', NULL, 'Zips to hit
39819
39817
39834
39828
31792
31957
32312
32317
32309
32303
32333', NULL, '400 E Shotwell St', NULL, 'Bainbridge', 'GA', '39819', '(229) 246-7900', 'Ronnie Godwin', NULL, NULL, 'ronnie@godwinjewelers.com', NULL, 'www.godwinjewelers.com', NULL, '(229) 306-5138', FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Godwin Jewelers - Thomasville, GA', NULL, '39819
39817
39834
39828
31792
31957
32312
32317
32309
32303
32333', NULL, '202 S Broad Street', NULL, 'Thomasville', 'GA', '31792', '(229) 233-8536', 'Ronnie Godwin', NULL, NULL, 'ronnie@godwinjewelers.com', NULL, 'www.godwinjewelers.com', 'godwin-thomasville', '(229) 475-0461', FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Hodges Jewelry', 'Tanya', NULL, NULL, '42 West Broad St.', NULL, 'Camilla', 'GA', '31730', '(229) 336-1399', 'Joy & Sara 229-336-1399 please call  hodgesjewelrycamilla@gmail.com  e', NULL, NULL, 'Hodgesjewelrycamilla@gmail.com', NULL, 'https://www.hodgesjewelrycompany.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'K E Butler & Co Jewelers', 'Tanya', NULL, NULL, '1303B E 1st St at Palmer Place', NULL, 'Vidalia', 'GA', '30474', '912/537-3623', 'Kathy', NULL, NULL, 'diamonds@kebutler.com', NULL, 'https://www.kebutler.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Pickens Jewelers', 'Tanya', NULL, NULL, '480 E Paces Ferry Rd NE', NULL, 'Atlanta', 'GA', '30305', '(404) 237-7885', 'Hayes
Kim - Send emails to kim@pickensinc.com  kimberly.b.pickens@gmail.com', 'hays@pickensinc.com', NULL, 'anna@pickensinc.com', 'kimberly.b.pickens@gmail.com', 'https://www.pickensinc.com/', 'pickens', NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Smith''s Jewelers', 'Tanya', '770-335-6643 Natalie’s cell', NULL, '130 West Jackson Street', NULL, 'Dublin', 'GA', '31021', '478-272-5112', 'Natalie Curry', NULL, NULL, 'natalie@smithsofdublin.com', NULL, 'smithsofdublin.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Tena''s Fine Diamond and Jewelry', 'Tanya', NULL, NULL, '14 N. Forest Avenue', NULL, 'Hartwell', 'Ga', '30643', '(706) 376-2776', 'Alwasy send everything to the Washington Location', NULL, NULL, 'tenas@hartcom.net', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Tena''s Fine Diamonds and  Jewelry', 'Tanya', '500  5 x 7 for each store
10 - 5 each store', NULL, '283 East Clayton Street', NULL, 'Athens', 'GA', '30601', '(706) 543-3473', NULL, NULL, NULL, 'tenasathens@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Tena''s Fine Diamonds and Jewelry', 'Tanya', NULL, NULL, '6 S. Oliver Street', NULL, 'Elberton', 'GA', '30635', '(706) 283-9381', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Tena''sFine Diamond And  Jewelry', 'Tanya', NULL, NULL, '13 W. Robert Toombs Avenue', NULL, 'Washington', 'GA', '30673', '(706) 678-2614', NULL, NULL, NULL, 'http://www.tenas.com/', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Thomas Hill Jewelers', 'Tanya', 'They Like 5 x 7 postcards

10 - 6', NULL, '110 E M L King Jr Dr Ste 1A', NULL, 'Hinesville', 'GA', '31313', '(912) 876-6036', 'Chrisie Hill', NULL, NULL, 'thomashilljewelers@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Town Square', 'Tanya', NULL, NULL, '101 Stonewall Ave E,', NULL, 'Fayetteville', 'GA', '30214', '(770) 460-7787', 'Talk to Mary Kate Sharpless - manager   Alex Rodriquez  - owner', NULL, NULL, 'marykate@tsj.us', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Whidby Jewelers', 'Tiff', 'RJO Store
Open Phone Scheduling Ph #   706-703-4814

Newspaper and Radio Info
Radio
Dock 103.9 & Lake Country 94.7, Chip Lyness Radio talk host - 706-453-4140 this goes to Ashley - left msg
Since I am already on the Radio if you want me to record the buying event ads you sent I can do that.

NewsPaper
The Morgan County Citizen, Alexis Brown 706-318-1244 - 500 to $1000

The Lake Oconee News 706-707-4240 Heather - guessing 500 to $10000

The Monticello News No phone number just email them: - hoping the same - had to email these people 
https://themonticellonews.com/index0.htm?twindow=Form&smenu=148&pform=ContactUs&mad=No&sname=target_form2.asp&site=themonticellonews.com.', NULL, '177 W Jefferson St', NULL, 'Madison', 'GA', '30650', '706/752-0105', 'Ben Whidby', NULL, NULL, 'ben@whidbyjewelers.com', NULL, 'whidbyjewelers.com', 'whidby', NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Bacon Jewelers', 'Ann', 'RJO', NULL, '1217 S.E. Marshall St', NULL, 'Boone', 'IA', '50036', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Becker''s Diamonds', 'Tiff', 'VIP show: Friday, October 27th, time: TBD
1 day show: Saturday, October 28th, time: 10- 5 or 6 need to confirm which.', NULL, '401 S. Gear Avenue', NULL, 'Burlington', 'IA', '52655', '(319) 752-3196', 'Bill', NULL, 'Alyssa', 'bill@beckerdiamonds.com', 'alyssa@beckerdiamonds.com', 'www.beckerdiamonds.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'James Martin Jewelers', 'Ann', NULL, NULL, '4340 Asbury Rd Suite 1', NULL, 'Dubuque', 'IA', '52002', '(563) 556-5661', NULL, NULL, NULL, 'lucas@dolandjewelers.com', NULL, 'www.jamesmartinjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Hendrickson''s Fine Jewelry', 'Ann', NULL, NULL, '5685 N Glenwood St', NULL, 'Boise', 'ID', '83714', '(208) 853-1615', 'Contact name is Sarah, her email is sarah.hendricksonsjewelry@gmail.com', NULL, NULL, 'sarah.hendricksonsjewelry@gmail.com', NULL, 'hendricksonsjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'K & Co', 'Ann', NULL, NULL, '1060 S. Ancona Ave. # 120', NULL, 'Eagle', 'ID', '83616', '(208) 629-2246', 'Rich Neiuk', NULL, NULL, 'KandCo.Jewelers@hotmail.com', NULL, 'www.kandcofamilyjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Mason Jewelers - Greencastle location', 'Ann', 'RJO', NULL, '45 Putnam Plaza', NULL, 'Greencastle', 'ID', '46135', '(765) 653-5012', 'Becky   masonjewelersinc@yahoo.com, bbphoto36@gmail.com', NULL, NULL, 'masonjewelersinc@yahoo.com, bbphoto36@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', TRUE, 'Bay Area Diamond', 'Ann', NULL, NULL, '742 Butterfield Rd', NULL, 'Mundelein', 'IL', '60060', '(847) 680-4450', 'Brian and Ryan', NULL, NULL, 'Brian@bayareadiamond. Ryan@bayareadiamond.com', NULL, 'www.bayareadiamond.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Davidson Jewelers', 'Tanya', NULL, NULL, '153 Avenue of the Cities', NULL, 'East Moline', 'IL', '61244', '(920) 731-4740', 'David Schlosser', NULL, NULL, 'davidsonjewelers@aol.com', NULL, 'Davidsonjewelers.net', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Gem Love', 'Radica', NULL, NULL, '115 N. Oak Park Ave. #100', NULL, 'Oak Park', 'IL', '60301', '708-759-0200', 'Jen', 'Laura', NULL, 'jen@gemlove.shop', 'laura@gemlove.shop', 'www.shopgemjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Georgetown Jewelers', 'Tanya', NULL, NULL, '351 Georgetown Square', NULL, 'Wood Dale', 'IL', '12065', '(630) 766-4137', 'Liz - owner  GEORGETOWNJEWELERS@GMAIL.COM IS FOR sTEPHANIE - tHE MANAGER', NULL, NULL, 'liz.gj.351@gmail.com,georgetownjewelers@gmail.com', NULL, 'www.georgetownjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'K Hollis Jewelers, Boutique & Wine Bar', 'Kelly', 'wants a TS', '10 - 6, 10 - 5 - Sat', '2030 Main St', NULL, 'Batavia', 'IL', '60510', '630-879-8003', 'Karen - Store owner', NULL, NULL, 'Karen@khollisjewelers.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Keswick Jewelers', 'Radica', NULL, NULL, '69 South Evergreen Ave.', NULL, 'Arlington Heights', 'IL', '60005', '(847)394-9365', 'Mariusz Bialas - direct Cell phone 847-322-7380', NULL, NULL, 'info@keswickjewelers.com', 'danny@keswickjewelers.com', 'keswickjewelers.com', NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Lustig Jewelers', 'Radica', NULL, NULL, '281 W Townline Rd', NULL, 'Vernon Hills', 'IL', '60061', '(847) 680-7300', 'Dan', NULL, NULL, 'dan@lustigjewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Lyla Jewelers', 'Tanya', NULL, NULL, '6834 95th St', NULL, 'Oak Lawn', 'IL', '60453', '(708) 599-0040', NULL, NULL, NULL, 'http://lylajewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Zembar Jewelers', NULL, NULL, NULL, '2457 E Joliet Hwy', NULL, 'New Lenox', 'IL', '60451', '(815) 485-7280', 'Kathy Lyons', NULL, NULL, 'zembarjewelers@att.net', NULL, 'zembarjewelers@att.net', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Disinger Jewelers', 'Tanya', NULL, NULL, '3770 N. Newton St.', NULL, 'Jasper', 'IN', '47546', '(812) 482-4833', 'Teresa', NULL, NULL, 'teresa@disinger.com', NULL, 'disinger.com', 'disinger', '(812) 445-6164', TRUE, TRUE, 'No Hold', 'Disinger Buying Event Questionnaire (1).docx (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/SEH0fnzmDrsNDNFqNtmipQ/L-a3qmCmTRSIK_LnopJnraIQOJ0_WErBlRR8buGv3iBX4jQEKlCAk8ZxzKneB13h-E1JHD6KW0Znps1gB7ilpDcYGKv3Ig7JU2j5D1lNoEn2DBdDjF0tEW28LnWmAM6KcKOI1CevDGvLnGQvgGPQxy9C4sBHNmObDftEVbSRg22XhrYEnZh8Cy8XXZVtWrDp/vRpTKM_DqumoqFsmETbSpLvDVQRXJyKeZqOIetZpqHA)'),
  ('BEB', TRUE, 'Fernbaugh''s Jewelers', 'Tanya', NULL, NULL, '206 North Michigan St.', NULL, 'Plymouth', 'IN', '46563', '(574) 493-1577', 'loriv', 'brianv@fernbaughs.com', NULL, 'loriv@fernbaughs.com', NULL, 'fernbaughsjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Koerber''s Fine Jewelry', 'Tanya', NULL, NULL, '3095 Blackiston Mill Rd', NULL, 'New Albany', 'IN', '47150', '(812) 945-5959', 'jacquelyn Koerber  cell 502-523-8415  owner', NULL, NULL, 'jacquelyn@koerbersfinejewelry.com', NULL, 'www.koerbersfinejewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Mason Jewelers  - Plainfield location', 'Ann', 'RJO', NULL, '1822 E. Main ST', NULL, 'Plainfield', 'IN', '46168', '(317) 839-3202', 'Becky   masonjewelersinc@yahoo.com, bbphoto36@gmail.com', NULL, NULL, 'masonjewelersinc@yahoo.com, bbphoto36@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Burnell''s Fine Jewelry', 'Tiff', NULL, NULL, '550 N Rock Rd Ste 104', NULL, 'Wichita', 'KS', '67206', '(316) 634-2822', 'Kristi and Nathan are the Owners', NULL, NULL, 'kristi@burnells.com', NULL, 'burnells.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Comeau Jewelry', 'Tanya', NULL, NULL, '200 E Centennial Dr', 'Ste 8', 'Pittsburg', 'KS', '66762', '(620) 231-2530', 'Chad Comeau', NULL, NULL, 'comeaujewelry@gmail.com', NULL, 'http://www.comeaujewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'K Westphal Jewelers  - Andover', 'Alex', 'She is running this event at the same time as her as her 21st store anniversary.', NULL, '614 N Andover Rd', NULL, 'Andover', 'KS', '67002', '(316) 733-1908', 'Katie Westphal', NULL, NULL, 'kwtot17@icloud', NULL, 'kwestphaljewelers.net', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Nicholaus Jewelry & Design', 'Ann', NULL, NULL, '119 S Main St', NULL, 'Hutchinson', 'KS', '67501', '(620) 664-1906', 'Meredith', NULL, NULL, 'meredith@nicholausjewelry.com', NULL, 'nicholausjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Toner Jewelers in Prairiefire', NULL, NULL, NULL, '6285 West 135th Street', NULL, 'Overland Park', 'KS', '66223', '(913) 663-3092', 'Alisha and Mike', NULL, NULL, 'https://www.tonerjewelers.com/', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Westphal Jewelers - Hutchinson', NULL, 'Alex''s account', NULL, '127 N Mail St', NULL, 'Hutchinson', 'KS', '67501', '(620) 669-8109', 'Domae Splonkowski', NULL, NULL, 'rwestphal1044@sbcglobal.net', NULL, 'https://www.rwestphal.net', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Gwen''s Fine Jewelers', NULL, 'From John  3/6 - sent pre event cards', 'M-F10 - 6, Sat 10 - 4', '841 B Eastern Bypass', NULL, 'Richmond', 'KY', '40475', '(859) 624-9600', 'Gwen Issac', NULL, NULL, 'gwen@gwensfinejewelers.com', 'jewelryadvisor@gwensfinejewelers.com', NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Michelson Jewelers', 'Ann', NULL, NULL, '5017 Hinkleville Rd', NULL, 'Paducah', 'KY', '42001', '(270) 443-9200', 'Patty Lane', NULL, NULL, 'plane@michelson-jewelers.com', NULL, 'michelson-jewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'West End Jewelers', 'Kelly', 'Wants a buy - RJO', NULL, '319 Ferry St', NULL, 'Russell', 'KY', '41169', '(606) 834-1414', 'Jackie Slone', NULL, NULL, 'jackie@westendjewelers.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Andy''s  Jewelers', 'Tanya', NULL, NULL, '204 Feu Follet Rd.', 'Ste. 300', 'Lafayette', 'LA', '70508', '(337) 593-0282', 'Andy Truxillo', 'Jonathan', NULL, 'andysjewelry@gmail.com', 'jonathan.andysjewelry@gmail.com', 'http://www.andysjewelry.net', 'Andys', NULL, FALSE, FALSE, '5 days', NULL),
  ('BEB', TRUE, 'Bailey''s Jewelry', 'Tanya', NULL, NULL, '2934 E. Texas St. ste.100', NULL, 'Bossier City', 'LA', '71111', '(318) 746-7087', 'Paul Little', NULL, NULL, 'baileysjewelers@bellsouth.net', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, FALSE, 'Gary Blanchard Jewelers', 'Kelly', 'Wants a BUY - RJO', NULL, '5317 Main Street', NULL, 'Zachary', 'LA', '70791', '(225) 654-0622', 'Gary Blanchard', NULL, NULL, 'GNBJewelers@bellsouth.net', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Rihner''s Jewelers', 'Tanya', NULL, NULL, '91 Westbank Expressway', 'Suite 530', 'Gretna', 'LA', '70053', '(504) 391-0183', 'Rudy and', NULL, NULL, 'Customerservice@rihnersjewelers.com', NULL, 'rihnersjewelers.com', NULL, NULL, FALSE, FALSE, '30 day', NULL),
  ('BEB', FALSE, 'Cindi''s Diamonds Jewelry', 'Tanya', NULL, NULL, '40 Central Street', NULL, 'Foxborough', 'MA', '2035', '(508) 543-4943', NULL, NULL, NULL, 'cindihaddaddrew@gmail.com', NULL, 'http://www.cindisjewelry.net', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'H. Brandt', 'Tanya', '"
Show date October 19th.  Show hours either 10-6 or 10-7 waiting to hear on this."


 hannoush92@hannoush.com', NULL, '31 Main St', NULL, 'Natick', 'MA', '01760', '(508) 653-1410', 'Stew', NULL, NULL, 'info@hbrandtjewelers.com', NULL, 'hbrandtjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Jewel in the Sea', 'Tanya', NULL, NULL, '6 Straight Wharf', NULL, 'Nantucket', 'MA', '02554', '508/228-2448', 'Jack Pearson - owner', NULL, NULL, 'jack@jewelinthesea.com', NULL, 'jewelinthesea.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Khan Diamonds Inc', 'Kelly', 'This came in before rjo  2/18.26', NULL, '333 Washington St #516', NULL, 'Boston', 'MA', '02108', '978-771-0754', 'Igbal Khan  or Iqbal Khan', NULL, NULL, 'halodiamonds@gmail.com', NULL, 'Khandiamonds.com', NULL, NULL, NULL, NULL, NULL, NULL),
  ('JLC', TRUE, 'Osterville Jewelers', 'Tiff', NULL, NULL, '1112 Main St.', NULL, 'Osterville', 'MA', '02655', '(508) 428-2872', 'Gregory Lennox', NULL, NULL, 'ostervillejewelers@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Sergio''s Fine Jewlers', 'Tanya', NULL, NULL, '10132 Baltimore National Pike Suite A & B', NULL, 'Ellicott City', 'Maryland', '21042', '(410) 461-4400', 'Tim.sergios@yahoo.com
Debbie@sergiosjewelers.com', NULL, NULL, 'debbie@sergiosjewelers.com', NULL, 'sergiosjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Dickinson Jewelers', NULL, 'DUNKIRK MARKET PLACE
10286 SOUTHERN MARYLAND BLVD.
DUNKIRK, MD 20754
(301) 855-8770

There is a 2nd store
PRINCE FREDERICK MARKET SQUARE
916 COSTLEY WAY
PRINCE FREDERICK, MD 20678
(410) 535-4338', NULL, 'Dunkirk Market Place', '10286 Southern Mayrland Blvd', 'Dunkirk', 'MD', '20754', '(301) 855-8770', 'Kathy  301-717 4555', NULL, NULL, NULL, NULL, 'https://www.dickinsonjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Dickinson Jewelers -  PRINCE FREDERICK', NULL, 'PRINCE FREDERICK MARKET SQUARE
916 COSTLEY WAY
PRINCE FREDERICK, MD 20678
(410) 535-4338
MONDAY:
CLOSED
TUESDAY - FRIDAY:
10:00AM - 6:00PM
SATURDAY:
10:00AM - 4:00PM
SUNDAY:
CLOSED', NULL, '916 COSTLEY WAY', NULL, 'PRINCE FREDERICK', 'MD', '20678', '(410) 535-4338', NULL, NULL, NULL, NULL, NULL, 'https://www.dickinsonjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Dickinson Jewelers - Dunkirk', NULL, 'DUNKIRK MARKET PLACE
10286 SOUTHERN MARYLAND BLVD.
DUNKIRK, MD 20754
(301) 855-8770
MONDAY:
CLOSED
TUESDAY - FRIDAY:
10:00AM - 6:00PM
SATURDAY:
10:00AM - 4:00PM
SUNDAY:
CLOSED', NULL, '10286 SOUTHERN MARYLAND BLVD', NULL, 'DUNKIRK', 'MD', '20754', '(301) 855-8770', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Dickinson Jewelers - Prince Frederick', NULL, 'PRINCE FREDERICK MARKET SQUARE
916 COSTLEY WAY
PRINCE FREDERICK, MD 20678
(410) 535-4338

MONDAY:
CLOSED
TUESDAY - FRIDAY:
10:00AM - 6:00PM
SATURDAY:
10:00AM - 4:00PM
SUNDAY:
CLOSED', NULL, '916 COSTLEY WAY', NULL, 'PRINCE FREDERICK', 'MD', '20678', '(410) 535-4338', 'Kathy', NULL, NULL, NULL, NULL, 'https://www.dickinsonjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Little Treasury', 'Ann', 'RJO', NULL, '2506 New Market Lane', NULL, 'Grambrills', 'MD', '21054', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Park Place Jewelers', 'Ann', NULL, NULL, '12720 Ocean Gateway Hwy.', NULL, 'Ocean City', 'MD', '21842', '(410) 213-9220', 'Jill', 'Todd Ferrante - does not read email', NULL, 'Jill@parkplacejewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'R. Bruce Carson Jewelers', 'Ann', '1000 4 x 6', NULL, '12814-G Shank Farm Way', NULL, 'Hagerstown', 'MD', '21742', '(301) 739-0830', 'Nicole', NULL, NULL, 'nicole@carsonjewelers.com', NULL, 'carsonjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Sanders Diamond Jewelers', 'Ann', NULL, NULL, '3820 Mountain Rd', NULL, 'Pasadena', 'MD', '21122', '(410) 360-5118', 'Danielle Sanders-Main', NULL, NULL, 'dsanders@sandersjewelers.com', NULL, 'https://www.sandersjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Saxon''s Diamond Center - Aberdeen', 'Ann', '217 Baltimore Pike
Bel Air, MD 21014
(410) 989-4819

1013 Beards Hill Rd, Suite 103,
Aberdeen, MD 21001
(410) 593-3726', NULL, '1013 Beards Hill Rd #103', NULL, 'Aberdeen', 'MD', '21001', '(410) 272-3322', 'Vic Pierorazio - owner', NULL, NULL, 'vic@saxonsdiamondcenters.com', NULL, 'https://www.saxonsdiamondcenters.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Saxon''s Diamond Centers', 'Ann', '1000 4 x 6', NULL, '217 Baltimore Pike', NULL, 'Bel Air', 'MD', '21014', '(410) 836-8000', 'Contact names are Vic and Kevin....
kevin@saxonsdiamondcenters.com', NULL, NULL, 'vic@saxonsdiamondcenters.com, kevin@saxonsdiamondcenters.com', NULL, 'saxonsdiamondcenters.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Brown Goldsmiths', 'Tiff', 'Tiffany account -    Abbie wants a Buy.  Freeport is only 8000 people - lets see what the trunk show does.', NULL, '11 Mechanic St.', NULL, 'Freeport', 'ME', '04032', '(207) 865-4126', 'Abbie Hinds-Aldrich', NULL, NULL, 'ahinds-aldrich@browngoldsmiths.com', NULL, 'browngoldsmiths.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Ellsworth Jewelers', NULL, NULL, NULL, '126 Downeast Hwy', 'PO Box 446', 'Ellsworth', 'ME', '04605', '(207) 610-1735', 'Kimberly C. Snow', NULL, NULL, 'kim@ellsworthjewelers.com', NULL, 'www.ellsworthjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Windham Jewelers', NULL, NULL, NULL, '765 Roosevelt Trail St.', '#16', 'Windham', 'ME', '04062', '(207) 892-6700', NULL, NULL, NULL, 'kathleen@windhamjewelers.net', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', FALSE, 'Erickson Jewelers', NULL, NULL, NULL, '511 S Stephenson Ave', NULL, 'Iron Mt', 'MI', '49801', '(906) 828-1307', NULL, NULL, NULL, 'sherri@ericksonjewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Patina Jewelers', 'Radica', NULL, NULL, '110 E. Chicago Blvd', NULL, 'Tecumesch', 'MI', '49298', NULL, 'Jackie and Cheyenne', NULL, NULL, 'patinajewelers@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Thomas A Davis Jeweler', 'Tanya', NULL, NULL, '39 East 8th St. Suite 110', NULL, 'Holland', 'MI', '49423', '616 392 1266  ext 12 for Kyah', 'Kyah', NULL, NULL, 'kyah@thomasadavis.com', NULL, 'https://www.thomasadavis.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Croft & Stern Jewelry', 'Ann', 'Kelly thinks the magazine will help

============ Forwarded message ============
From: Laura Bjorgo <laura@localmedia.co>
To: "Kelly Sternau"<info@croftandstern.com>
Date: Mon, 30 Sep 2024 07:52:58 -0700
Subject: Maple Grove Magazine- recap & options
============ Forwarded message ============

Hello Kelly,
Happy Monday! I hope you had a great weekend. I wanted to follow up with a couple of options from our meeting a couple weeks ago. I''ve included the 2025 media kit along with information on the targeted email blast option.

Maple Grove Magazine: (bi monthly): Mailed complimentary to the top 9200 affluent homeowners.
Issue dates for 2025 include: Jan/Feb 25, March/April 25, May/June 25, July/Aug 25, Sept/Oct 25, Nov/Dec 25

Option 1: 1/2 page ad size horizontal or vertical-
3x rate: $1375 per ad
6x rate: $1300 per ad 

Option 2: 1/3 square or vertical- 
3x rate: $895 per ad 
6x rate: $850 per ad 


Newspaper guy for Star tribune is Mike Possin
Very expensive.  Cheapest I can get them down is 12,000 for FPFC Sunday and Tues in Main for $12,000', NULL, '7897 Main St', NULL, 'Maple Grove', 'MN', '55369', '(763) 494-5700', 'Kelly Sternau', NULL, NULL, 'kelly@croftandstern.com', NULL, 'www.croftandstern.com', 'croftandstern', NULL, FALSE, FALSE, 'no hold', NULL),
  ('BEB', TRUE, 'Ken K. Thompson Jewelry', 'Ann', '1080 Paul Bunyan Dr NW
 Bemidji. MN  56601
Store Hours
Weekdays9AM - 5:30PM
Sat9AM - 5PM
SunClosed', NULL, '1080 Paul Bunyan Dr NW', NULL, 'Bemidji', 'MN', '56601', '(218) 751-1433', 'Dale', 'brandon@kenkthompsonjewelry.com', 'tammy@bottomlineblack.com', 'dale@kenkthompsonjewelry.com', NULL, 'kenkthompsonjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Lasker Jewelers - Rochester', 'Tanya', '101 First St SW
Rochester, MN 55416
(507) 288-5214

3705 Oakwood Mall Drive
Eau Claire, WI 54701
 p. 715-835-5914', NULL, '101 First St SW', NULL, 'Rochester', 'MN', '55416', '(507) 288-5214', 'Nicole

Lindsey is their graphic artist who does the proofing', NULL, NULL, 'nicole@laskers.com     lindsey@5forwardmarketing.com', NULL, 'https://laskers.com/company/locations/rochester-mn/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Melgram Jewelers', 'Ann', NULL, NULL, '103 1st St SE', NULL, 'Little Falls', 'MN', '56345', '(320) 632-3330', 'Peter Grams', NULL, NULL, 'peter@melgramjewelers.com', NULL, 'www.melgramjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', FALSE, 'Patterson''s Diamond Company - Mankato', NULL, NULL, NULL, '1031 Madison Ave', NULL, 'Mankato', 'MN', '56001', '(507) 625-1625', 'Mankato - Abby', NULL, NULL, 'apatterson1625@gmail.com', NULL, 'www.pattersonsdiamondcenter.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', FALSE, 'Patterson''s Diamond Company - New Ulm', NULL, NULL, NULL, '117 N Minnesota St', NULL, 'New Ulm', 'MN', '56073', '(507) 354-2613', 'New Ulm - Kristin', NULL, NULL, 'abby.olson2013@gmail.com', NULL, 'www.pattersonsdiamondcenter.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Adler''s Diamonds', 'Tanya', 'New Alex client', NULL, '1173 Colonnade Center Drive', NULL, 'St. Louis', 'MO', '63131', '(314) 394-2086', 'Jessica Gerring', NULL, NULL, 'jessica@adlersdiamonds.com', NULL, 'https://www.adlersdiamonds.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Comeau Jewelry Co.', 'Tanya', NULL, NULL, '1936 S. Rangeline Road', 'Suite E', 'Joplin', 'MO', '64804', '(417) 625-1755', 'Chad Comeau', NULL, NULL, 'comeaujewelry@gmail.com', NULL, 'www.comeaujewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Cornerstone Fine Jewelry', 'Tanya', NULL, NULL, '2821 S Glenstone Ave', NULL, 'Springfield', 'MO', '65804', '(417) 881-0667', 'Billy Smith', 'Luisa Smith', NULL, 'Billy@cornerstonejeweler.com', 'lisa@cornerstonejeweler.com', 'cornerstonejeweler.com', 'cornerstone', NULL, FALSE, FALSE, 'No Hold', NULL),
  ('BEB', TRUE, 'Jayson Jewelers', 'Ann', NULL, NULL, '115 Themis St', NULL, 'Cape Girardeau', 'MO', '63701', '(573) 334-8711', NULL, NULL, NULL, 'INFO@JAYSONJEWELERS.COM', NULL, 'JAYSONJEWELERS.COM', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'The Diamond Shop', NULL, NULL, NULL, '12 N Central Ave', NULL, 'Clayton', 'MO', '63105', '(314) 714-6486', 'nikki   Mona Kohn & Thom', NULL, NULL, 'Nikki@thediamondshop.net', NULL, 'thediamondshop.net', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Allen''s Fine Jewelry - Grenada, MS', 'Tanya', NULL, NULL, '1322A Sunset Drive', NULL, 'Grenada', 'MS', '38901', '(662) 226-6753', 'John Cravens', 'Cheryl', NULL, 'johnacravens@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Allen''s Fine Jewelry - Winona, MS', 'Tanya', NULL, NULL, '138 North Applegate St.', NULL, 'Winona', 'MS', '38967', '(662) 283-3126', 'Kyle', NULL, NULL, 'kylecravens35@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Horne Custom Jewelry', 'Tanya', NULL, NULL, '1500 Pass Road', NULL, 'Gulfport RD', 'MS', '39501', '(228)731-3713', 'Melissa 228-731-3713 or Cliff 228-323-4865', NULL, NULL, 'horne_melissahorne@yahoo.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Kux Jewelers', NULL, 'Came from John D  60 years in busn.   otc - yes, no hold  20,000 active mailing list - senior area', '9:30 to 6  9:30 to 4  Do the 10 - 5 all three days', '650  N. 15th Ave', NULL, 'Laurel', 'MS', '39440', '601-428-0674', 'Lacey - owner', NULL, NULL, 'lacey@kuxjewelers.com', NULL, 'www.kuxjewelers.com', 'kux', '601-533-9081', FALSE, FALSE, 'no hold', 'https://docs.google.com/document/d/11ZvBt6SWnxnjUTKOGdiZDGUDrycdsx9E/edit?usp=sharing&ouid=100104416632831253250&rtpof=true&sd=true'),
  ('BEB', TRUE, 'Littles Jewelers', 'Tanya', NULL, NULL, '2220 S Harper Rd', NULL, 'Corinth', 'MS', '38834', '(662) 286-5041', NULL, NULL, NULL, 'stacey@littlesjewelers.net;robynne@littlesjewelers.net', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Selman''s Jewelers', 'Tanya', 'Cocktail /and all day', NULL, '1311 Delaware Ave', NULL, 'McComb', 'MS', '39648', '(601) 684-1517', 'Kristina Smith -s the helper in the store.  Kristin is the owner and makes decisions.   - send emails to Kristin', NULL, NULL, 'kristin@selmansjewelers.com', NULL, 'https://www.selmansjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'WP Shelton', 'Tanya', 'RJO 
Open Phone #  228-567-5192
21 day hold', NULL, '1516 Government St', NULL, 'Ocean Springs', 'MS', '39564', '228/875-4842', 'Dianne  or Cathy owner', NULL, NULL, 'info@wpshelton.com', 'alexis@wpsheltonjeweler.com', 'https://wpsheltonjewelers.com/', 'WPShelton', NULL, FALSE, FALSE, '21 day', NULL),
  ('BEB', TRUE, 'Eaton Turner Jewelry', 'Tiff', NULL, NULL, '1735 N Montana Ave.', NULL, 'Helena', 'MT', '59601', '(406) 442-1940', 'Katrina Johnson', NULL, NULL, 'info@eatonturnerjewelry.com', NULL, 'eastonturnerjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Gem Gallery', 'Tiff', NULL, 'T - S 10-5:30', '402 E Main St STE 2', NULL, 'Bozeman', 'MT', '59715', '406-587-9339', 'Jason Baide , Erin Store manager', NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Jewelry Design Center', 'Ann', 'RJO', NULL, '2501 Brooks Street', NULL, 'Missoula', 'MT', '59801', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', FALSE, 'MC Jewelry', NULL, NULL, NULL, '705 Main St', NULL, 'Miles City', 'MT', '59301', '(406) 234-4064', NULL, NULL, NULL, 'milescityjewelry@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Sugar Plum Fine Jewelry', 'Tiff', NULL, NULL, '103 N Douglas St.', NULL, 'Glendive', 'MT', '59330', '(406) 377-5788', NULL, NULL, NULL, 'kate@sugarplumfinejewelry.com', NULL, 'sugarplumfinejewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Bailey''s Fine Jewelry', 'Ann', 'They order from our  option - but make it locally.
Im not sure if it is 5 x 7 or 9 x 6
Main address on Postcards is 
Bailey''s Fine Jewelry, PO Box 17709, Raleigh, NC 27619
Rocky Mt - 117 Winstead Avenue
Greenville - 511 Red Banks Road
Raleigh - Cameron Village - 415 Daniels Street', NULL, 'Raleigh -Cameron Village, Greenville, Rocky Mount', 'P O box 17709', 'Raleigh', 'NC', '27619', '919-832-4144 ext. 1901', 'Kelly Crisp', NULL, 'Ashley', 'Kelly.Crisp@baileybox.com', 'ashley.moore@baileybox.com', 'baileybox.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Ellis Jewelers', NULL, NULL, NULL, '29 Union Street South', NULL, 'Concord', 'NC', '28025', '704-782-9314 704-609-2790', NULL, NULL, NULL, 'dan@ellisfinejewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Facet Foundry Jewelry Studio', 'Tanya', '10 to 5 on Sat  10 - 6 on Thursday', NULL, '530 S New Hope Rd', NULL, 'Gastonia', 'NC', '28054', '(704) 867-5332', 'Brent', NULL, 'Michelle - michelle@facetfoundryjewelry.com', 'bmesser1961@att.net', NULL, 'facetfoundryjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Grant Laughter Jewelry', 'Ann', '1800 Hendersonville Rd
Asheville, NC 28803
(828) 274-5770
grantljewelry.com', NULL, '1800 Hendersonville Rd', NULL, 'Asheville', 'NC', '28803', '(828) 274-5770', 'Grant', NULL, NULL, 'grantljewelry.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Hearne''s Jewelry', 'Ann', NULL, NULL, '1331 McCarthy Blvd', NULL, 'New Bern', 'NC', '28562', '(252) 637-2784', 'Madison', NULL, NULL, 'madison@hearnesjewelry.com', NULL, 'hearnesjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Jewelry by Gail', 'Ann', '1800 4 x 6 - duratran instead of poster    10 - 5 each day', NULL, '207 E. Driftwood | MP 10 1/4 |', 'MP 10 1/4', 'Nags Head', 'NC', '27959', '800-272-9817  1-252-441-5387', 'Mark Womach', NULL, 'Joan Ferrier', 'markjbg9@gmail.com', 'joan@jewelrybygail.com', 'http://www.jewelrybygail.com', 'gail', NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Tammy''s Jewelry', 'Tanya', 'Times -10 - 5
500 4 x 6', NULL, '146 North Main St', NULL, 'Waynesville', 'NC', '28786', '(828) 456-4772', 'tammy 828 246 9761', NULL, NULL, 'tammy@tammys-jewelry.com', NULL, 'tammys-jewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Vaughan''s Jewelry', 'Tanya', 'Open Phone #', NULL, '311 S Broad St', NULL, 'Edenton', 'NC', '27932', '(252) 482-3525', 'Valerie Goodwin', NULL, NULL, 'valerie@vaughansjewelry.com', NULL, 'http://www.vaughansjewelry.com/', 'vaughans', NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Zorells Jewelry', 'Ann', NULL, NULL, '221 S. 9th Street', NULL, 'Bismarch', 'ND', '58504', NULL, 'Time Ells Jr,  & Sharon Ell sharon@zorells.com', NULL, NULL, 'timjr@zorells.com', NULL, 'zorells.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Malashock''s Jewelry', 'Ann', 'YES - Malashock''s has an appostrophy', '21 day', '16811 Burke St. #112', NULL, 'Omaha', 'NE', '68118', '(402) 496-9990', 'Deb', NULL, NULL, 'Deb@malashocks.com', 'jay.malashocks@gmail.com', 'malashocks.com/', 'malashocks', NULL, FALSE, FALSE, '21 day', NULL),
  ('BEB', TRUE, 'JoZach Jewelers', 'Tanya', NULL, NULL, '1 Pleasant St', NULL, 'Claremont', 'NH', '03743', '(603) 542-2953', 'Lori', NULL, NULL, 'http://jozachjewelers.net/', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Pearce Jewelers', 'Tiff', NULL, NULL, '41 Glen Rd', NULL, 'West Lebanon', 'NH', '03784', '(603) 298-8833', 'Lori Roy <lori@pearcejewelers.com', NULL, NULL, 'lori@pearcejewelers.com', NULL, 'pearcejewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Bentley''s Fine Jewelers', 'Tanya', NULL, NULL, '601 US-206 Unit #15', NULL, 'Hillsborough Township', 'NJ', '08844', NULL, 'Brandon', NULL, NULL, 'bentleysfinejewelers@gmail.com', NULL, 'www.bentleysfinejewelers.co', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Henry''s Fine Jewelry  - Summit, NJ', 'Tanya', NULL, NULL, '419 Springfield Ave', NULL, 'Summit', 'NJ', '07901', '(908) 273-3777', 'Henry Feldman', NULL, NULL, 'henry@henrysfinejewelry.com', NULL, 'https://henrysfinejewelry.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Henry''s Fine Jewelry - Basking Ridge', 'Tanya', NULL, NULL, '665 Martinsville Road', NULL, 'Basking Ridge', 'NJ', '07920', '(908) 903-0390', 'Henry Feldman', NULL, NULL, 'henry@henrysfinejewelry.com', NULL, 'henrysfinejewelry.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Roman Jewelers', 'Tanya', 'Open 7 days a week.', NULL, '500 Commons Way', NULL, 'Bridgewater', 'NJ', '08807', '(908) 575-1242', 'Lucy - and her cell phone  908-812-6314', NULL, NULL, 'Lucy@romanjewelers.com', NULL, 'www.romanjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Venus Jewelers', 'Tanya', NULL, NULL, '1024 Easton Avenue', NULL, 'Somerset', 'NJ', '08873', '(732) 247-4454', NULL, NULL, NULL, 'info@venusjewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Bullock''s Jewelry', NULL, NULL, NULL, '215 N Main St', NULL, 'Roswell', 'NM', '88201', '(575) 622-7451', 'Kyle Bullock  kyle@bullocksjewelry.com
Angela@bullocksjewelry.com', NULL, NULL, 'Angela@bullocksjewelry.com', NULL, 'bullocksjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Diamonds Evermore', 'Ann', NULL, NULL, '1407 N. Main St.', NULL, 'Clovis', 'NM', '88101', '(575) 935-7070', 'Gail Tarson', NULL, NULL, 'diamondsevermore@gmail.com', NULL, 'www.diamondsevermore.com', NULL, '(575) 400-3382', FALSE, FALSE, 'No Hold', NULL),
  ('BEB', TRUE, 'Garcia & Co', 'Larry', NULL, NULL, '4540 E Main St', NULL, 'Farmington', 'NM', '87402', '(505) 326-7353', NULL, NULL, NULL, 'Mark@garciajewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Harris Jewelers - Rio Rancho', 'Ann', 'Max said to hit this zip with eddms 87043
BUDGET $15,000', NULL, '909 36th Pl Suite A', NULL, 'Rio Rancho', 'NM', '87124', '(505) 892-3841', 'Max said to hit this zip with eddms 87043
BUDGET $15,000

Pamela@harrisjewelers.com is 2md contact', NULL, NULL, 'janelle@harrisjewelersnm.com', NULL, 'harrisjewelersnm.com', NULL, NULL, FALSE, FALSE, 'no hold', 'Harris Jewelers ABQ NM  Buying Event Questionnaire (1).docx (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/1raVVXl_Zq_XZ48-zwsWjQ/1PqbumBIECOsmndmhTQx_UwAFwiiGrLe--iLfHODDv3K1UYfrzZXbhZZbVNJrHrt0mKsulHq87g8QByKl9hQvZrQORBGsMRbb2-15JuwwFP5O7EjDoJoMUdrYJEcGQ_wFJW-dQp0WcA6TEh-We3suBxQUdnUo1ZaGru847K5_8ZunO1zJLJoTJIh5e675vmc/kBrRZ9skvyWGwQHuyeETu7gkogfxm8uKxllOyWGkdbo),Harris - NM  Customers_as_of_13_5_2023.csv (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/HdoLpWuAzi5XgCzzHRGsHQ/45NHHGMqtk_G_uWdsJvoKugEXiRsgl_tmEEubq695Jt2etrqrYdjyvfa2KXQ5F3O4ZQ7YCtaSz0-IuMhy4FQkqF2JgF0eN2-lUDy8fAEa8lgXOMaiBSMYZZcbKzGw1S4f070kn4uat5GbFf6xHGbRt6YXAUtvJ0HWPRs9seNY-rNF4wWtW-aPck8qyNvzQfy/HRHvE_qtxVSV12E2U-Z9v6tQmJ1cFH-jf8esN5151vc)'),
  ('BEB', FALSE, 'J.A. Jewelers & Co', NULL, NULL, NULL, '2909 E. 20th St', NULL, 'Farmington', 'NM', '87402', '(505) 599-9400', NULL, NULL, NULL, 'john@jajewels.com', NULL, 'jajewels.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'John Thomas Jewelers', NULL, 'John Thomas Jewelers is  husband to Janelle Mead Harris who has Harris Jewelers in Rio Rancho', NULL, '10501 Montgomery Blvd NE', '2nd Floor', 'Albuquerque', 'NM', '87111', '(505) 342-9200', 'John Thomas', NULL, NULL, 'SheSaidYes@johnthomasjewelers.com', NULL, 'johnthomasjewelers.com', 'JohnThomas', NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Shelton Jewelers', 'Ann', NULL, NULL, '7001 Montgomery Blvd NE', NULL, 'Albuquerque', 'NM', '87109', '(505) 881-1013', 'Elliott', NULL, NULL, 'sheltonjewelers.sarah@gmail.com', NULL, 'sheltonjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'BVW Jewelers', 'Ann', NULL, NULL, '35 Foothill Rd Suite 3', 'Ste 3', 'Reno', 'NV', '89511', '(775) 622-9015', 'Britten Wolf', NULL, 'Melissa', 'bvw@bvwjewelers.com', 'Mel@BVWjewelers.com - Melissa', 'www.bvwjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Huntington Jewelers', 'Sanja', NULL, NULL, '1990 Village Center Cir #6', NULL, 'Las Vegas', 'NV', '89134', '702/878-3677', 'Jenny 0', NULL, NULL, 'Jennyo@huntingtonjewelers.com', NULL, 'www.huntingtonjewelers.com', 'Huntington', NULL, FALSE, FALSE, '30 day', NULL),
  ('BEB', TRUE, 'Michael and Sons Jewelers', 'Ann', NULL, NULL, '1401 S Virginia St #150', NULL, 'Reno', 'NV', '89502', '(775) 786-5110', 'Michelle sales manager', 'Maddie is the marketing director', 'David Owner', 'maddie@michaelandsons.com
david@michaelandsons.com
michelle@michaelandsons.com', NULL, 'https://www.michaelandsonsjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', TRUE, 'Midtown Diamonds', 'Ann', NULL, NULL, '777 S Center St', '#102', 'Reno', 'NV', '89501', '(775) 825-3499', 'Erik Ottman', NULL, NULL, 'erik@midtowndiamonds.com', NULL, 'midtowndiamond.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Conti Jewelers', 'Tanya', 'Newspaper is Press & Sun Bulletin  800-253 5343  Store Manager - Beth Green.  Chris Daniel - owner', NULL, '532 Hooper Rd', NULL, 'Endwell', 'NY', '13760', '(607) 786-9670', 'Beth', NULL, NULL, 'beth@contijewelers.com', NULL, 'www.contijewelers.com', 'conti', NULL, FALSE, FALSE, '15 day', NULL),
  ('BEB', TRUE, 'Cornell''s Jewelers', 'Ann', NULL, NULL, '3100 Monroe Ave', NULL, 'Rochester', 'NY', '14618', '(585) 264-0100', 'Courtney', NULL, 'Michelle', 'Courtney@cornellsjewelers.com', 'michael@cornellsjewelers.com', 'http://www.cornellsjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Corwin''s Jewelers', NULL, 'Doing a cocktail party on the 20 - all day on the 21
Want save the date cards', NULL, '61 Main St. #1', NULL, 'Southhampton', 'NY', '11968', '(631) 283-1980', 'Travis Corwin', NULL, NULL, 'travis@Corwinsjewelers.com', NULL, 'http://www.corwinsjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Glennpeter Jewelers Diamond Centre', 'Tanya', NULL, NULL, '131 Colonie Center', 'Room 152', 'Albany', 'NY', '12205', '(518) 459-8009', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Glennpeter Jewelers Diamond Centre', 'Tanya', NULL, NULL, '1505 Half Moon Parkway', 'Route 9', 'Clifton Park', 'NY', '12205', '(518) 383-5295', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Glennpeter Jewelers Diamond Centre', 'Tanya', NULL, NULL, '1544 Central Ave.', NULL, 'Albany', 'NY', '12205', '(518) 689-3670', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Kay Cameron Jewelers', 'Tiff', '5/2022   Stay under 12,000 for this event.    The newspaper maybe worthless now - time to quit it.  
The Kay Cameron buy was $82K, a decent buy but we have to trim the fat. 

The $8500 ad was a waste, accounting for very few customers.

Also, that buy really needs to be $12K not a $17k expense. 

Do we have a spreadsheet with all ads and ad spending per event? 

Thanks, Max



   These following papers are great for the buying event:
*Southbays Neighbor Newspaper- Jeff Lambert email: jlambert@southbaysneighbor.com - this one is only $388 but it comes out on Weds - does not really work for us
*Newsday
*Suffolk County News  - I booked this one 688 - circ of 10,800 - go the back page on Thus the 12th
Any questions please let me know !
Be well,', NULL, '48 Main St', NULL, 'Sayville', 'NY', '11782', '(631) 567-1698', 'Trish
8/17/21  Please make note for next time. We need to change to: appointments necessary. Remove recommended.', NULL, NULL, 'Trish@kaycameronjewelers.com', NULL, NULL, 'KCameron', NULL, FALSE, FALSE, '30 day', NULL),
  ('BEB', TRUE, 'Malsons Jewelers', 'Tanya', '500 4 x 6', NULL, '440 86th St.', NULL, 'Brooklyn', 'NY', '11209', '(718) 491-6666', 'Morris and Mattie Kay', NULL, NULL, 'Morris@malsonsjewelers.com  Mattie Kay - Bellama45@gmail.comm', NULL, 'www.malsonsjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Mills Jewelers', NULL, '"Lilly pad or symphony 500 4 x 6 also wants a file of a large poster	 - order 8/9"', NULL, '51 Main St', NULL, 'Lockport', 'NY', '14094', 'Call or Text: 716-433-6456', 'Fritz', NULL, NULL, 'fritz@millsjewelers.com', NULL, 'https://www.millsjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, FALSE, 'Skaneateles Jewelry (Syracuse', NULL, 'Want a buy', NULL, '15 Jordan St.', NULL, 'Skaneateles', 'NY', '13152', '315-685-3253', 'Wes', NULL, NULL, 'service@cyndiamond.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'The Jewelbox', 'Tiff', 'Ithica Overline ads are 4c x 2.41" = (6.61"w x 2.41") 
cassie slater - local IQ', NULL, '301 Taughannock Blvd', NULL, 'Ithaca', 'NY', '14850', '(607) 257-4666', 'Micky Roof (she)
Alanna Greenly  info@ithacajewelbox.com', NULL, NULL, 'info@ithacajewelbox.com', NULL, 'ithacajewelbox.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Alan Miller Jewelers', 'Tanya', 'Let Alan Miller Develop all Marketing Plans in the future.  
Max thinks Spadea is too much', NULL, '3239 Navarre Ave', NULL, 'Oregon', 'OH', '43616', '(419) 693-4311', 'Alan Miller - father  419-367-7227 - this is Alan''s cell - nice guy', 'Cody Miller', 'Lilly - Manager', 'alanmillerjeweler@sbcglobal.net', 'alanmillerjewelersfax@gmail.com', 'www.alanmillerjewelers.com', 'alanmiller', NULL, FALSE, FALSE, 'Ohio - 5 days old unless notice from police have probable cause then hold to 30 days', NULL),
  ('BEB', FALSE, 'Dean''s Jewelry - Coshocton 25th & Mt Vernon 26th', NULL, '10 - 6   Market both stores on everything
Coshocton OH on the 25th and Mount Vernon OH on the 26th', NULL, '409 Main Street', NULL, 'Coshocton', 'OH', '43812', '(740) 622-4941', 'Michelle turner Ganz  Michelle@deansjewelry.com', NULL, NULL, 'Michelle@deansjewelry.com', NULL, 'www.deansjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Harris Jeweler -Ohio', 'Tanya', NULL, NULL, '1780 W Main St', NULL, 'Troy', 'OH', '45373', '(937) 335-0055', 'Bonnie', NULL, NULL, 'bonnie@harrisjeweler.com', NULL, 'harrisjeweler.com', 'Harris', NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'J Foster Jewelers', NULL, 'RJO  - talked to Ryan - wants a Buy in June - looks like a great store, 31 years family owned - Rolex preowned', NULL, '3100 Main Str4eet # 990', NULL, 'Maumee', 'OH', '43537', '419-878-9998', 'Anthony Bruno', NULL, NULL, 'antrbruno@yahoo.com', NULL, 'jfosterjewelers.com', NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Lambert Jewelers', 'Tanya', 'Mon, Wed, Fri: 9:30am-6pm
Tues, Thurs: 9:30am-7pm
Sat.: 9:30am-3pm', NULL, '327 East 5th Street', NULL, 'Marysville', 'OH', '43040', '(937) 642-2603', 'Carly   carly@lambertjewelers.com  
Gail  Gail@lambertjewelers.com', NULL, NULL, 'carly@lambertjewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Mees Jewelry', 'Tanya', NULL, NULL, '1080 N Bridge St # 12', NULL, 'Chillicothe', 'OH', '45601', '(740) 774-6337', 'Madelyn', NULL, NULL, 'mjewelry@hotmail.com', NULL, 'meesjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Pugh''s Diamond Jewelers', 'Tanya', '1202 Brandywine Blvd, Zanesville, OH 43701
(740) 452-8464
https://pughsdiamonds.com

Store hours are M - F - 10 - 6
Sat - 10 - 4', NULL, '1202 Brandywine Blvd.', NULL, 'Zanesville', 'OH', '43701', '(740) 452-8464', 'Contact Elena regarding postcards.
elena@pughmarketing.com', NULL, NULL, 'tricia@pughsdiamonds.com, elena@pughmarketing.com', NULL, 'pughsdiamonds.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Richter and Phillips Jewelers RJO', 'Ann', 'RJO', NULL, '601 Main St', NULL, 'Cincinnati', 'OH', '45202', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Schwartz Jewelers.', 'Ann', NULL, NULL, '6114 Hamilton Ave.', NULL, 'Cincinnati', 'OH', '45224', '(513) 541-5627', 'Marty & Andrea
schwartz.jewelers@fuse.net', NULL, NULL, 'schwartz.jewelers@fuse.net', NULL, 'schwartzjewelers.net', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Stambaugh Jewelers', 'Ann', NULL, NULL, '512 Clinton Street', 'P.O. Box 10', 'Defiance', 'OH', '43512', '(419) 782-4061', NULL, NULL, NULL, 'http://www.stambaughjewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'VONS DIAMONDS & JEWELRY', 'Ann', NULL, NULL, '3217 Elida Road', NULL, 'Lima', 'OH', '45805', '(419) 227-5616', NULL, NULL, NULL, 'http://www.vonsjewelry.com/', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Welling & Co', 'Tanya', 'Second Store -
Welling and Co 
208 Loveland Ave
Loveland, OH  45140', NULL, '8992 Cincinnati Dayton Rd', NULL, 'West Chester Township', 'OH', '45069', '(513) 779-8883', 'Bill welling

Newspaper contact is   Bark, Saeng <SMBark@designiq.com', NULL, NULL, 'billw@wellingandco.com', 'danielw@wellingandco.com', NULL, 'welling', NULL, FALSE, FALSE, 'no hold', 'Welling & Co New Buying Event Questionnaire.docx (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/1S0lzXQGdh-DMFRs2dJ2tg/8scmzkqsKHubQnmCHMj57gV1PfwjFevorzsWKmxx4kaAE1ZKgxCi0-n2ySXNRZ2P7rwso-pNmAV5v9HCra7f7ptG_CsWXcAG2Rud7WVsUsBziPA9jarr9f-qCjrdSEyOoMYst8njuJuoHYAwgTJcRFo6j3YrYyyxsTEGdQtNJLTrf12GDbPD9f36jATWM1Pm/Y4tKEERDDMvGS69IO2yZbBYvOj0-WmK0nHLke-fzo9g)'),
  ('BEB', TRUE, 'Worthington Jewelers', 'Ann', NULL, NULL, '692 High Street', NULL, 'Worthington', 'OH', '43085', '(614) 430-8800', 'cheryl@worthingtonjewelers.com,
theresa@worthingtonjewelers.com,
bob@worthingtonjewelers.com', NULL, NULL, 'Cheryl@worthingtonjewelers.com', NULL, 'http://www.worthingtonjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Alson Jewelers', 'Tanya', '1-888-88-ALSON216-464-6572 (f)
alsonjewelers.com
10 - 5 
Normally order  9 x 6 3000', '10 - 5', '28149 Chagrin Blvd.', NULL, 'Cleveland', 'Ohio', '44122', '(216) 464-6767', 'David - owner
Jill - Jill@alsonjewelers.com
Austin - ad man  austin@rosenbergadv.com', 'Jill', 'Austin - ad man  austin@rosenbergadv.com', 'David@alsonjewelers.com', 'Jill@alsonjewelers.com', 'alsonjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'J. David Jewelry', 'Alex /Sanja', 'Melissa - owner - Melissa@jdavid.com  
Go through Nate and Ian
Nate is the sale manager for both stores  nate@jdavid.com
landon@jdavid.com

1sr location  613', NULL, '8200 E 101st St', NULL, 'Tulsa', 'OK', '74133', '(918) 364-6300', 'Nate', 'Melissa - owner - Melissa@jdavid.com', 'Ian', 'nate@jdavid.com', 'Ian@jdavid.com', 'https://www.jdavidjewelry.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'McCoy Jewelers', 'Alex', NULL, NULL, '306 S Dewey ave', NULL, 'Bartlesville', 'OK', '74003', '(918) 336-4300', 'Laurie McCoy', NULL, NULL, 'laurie@mccoyjewelers.com', NULL, 'mccoyjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Vincent Anthony Jewelers', 'Tanya', NULL, NULL, '10038 South Sheridan Road', NULL, 'Tulsa', 'OK', '74133', '(918) 291-9700', NULL, NULL, NULL, 'lonnie@vincentanthony.com', NULL, 'www.vincentanthony.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Apland Design', 'Ann', NULL, NULL, '216 Oak Street', NULL, 'Hood River', 'OR', '97031', '(541) 386-3977', 'Ken', NULL, NULL, 'ken@aplandjewelers.com', NULL, 'www.aplandjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Diamonds by the Sea -  Lincoln City', 'Ann', NULL, NULL, '4079 D, NW Logan Rd', NULL, 'Lincoln City', 'OR', '97367', '(541) 994-6373', 'Katheryn', NULL, NULL, 'DiamondsByTheSeaNPT@gmail.com', NULL, 'www.diamondsbytheseainc.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Diamonds by the Sea - Newport', 'Ann', NULL, NULL, '2005 N. Coast Highway', NULL, 'Newport', 'OR', '97365', '(541) 265-7755', 'Katheryn', NULL, NULL, 'DiamondsByTheSeaNPT@gmail.com', NULL, 'www.diamondsbytheseainc.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Harbrook Jewelers', 'Ann', NULL, NULL, '97900 Shopping Center Ave', NULL, 'Harbor', 'OR', '97415', '(541) 469-5233', 'Jereny Small', NULL, NULL, 'harbrook@charter.net', NULL, 'http://harbrookjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Holliday Jewelry - Klamath', 'Ann', 'The event was 10 - 6 on both days', NULL, '2834 S 6th St', NULL, 'Klamath Falls', 'OR', '97603', '(541) 884-9033', 'Ray
Nathalie', NULL, NULL, 'Ray@hollidayjewelry.com', NULL, 'www.hollidayjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'HollidayJewelry - Medford OR', 'Ann', NULL, NULL, '2 North Central', NULL, 'Medford', 'OR', '97501', '(541) 499-6877', NULL, NULL, NULL, 'marketing@hollidayjewelry.com', NULL, 'www.hollidayjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Sherrie''s Jewelry Box', 'Ann', NULL, NULL, '12425 SW Main Street', NULL, 'Tigard', 'OR', '97223', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'SJ Custom Jewelers', NULL, 'RJO', NULL, '316 Northwest Coast Street', NULL, 'Newport', 'OR', '97365', '(541) 272-5300', NULL, NULL, NULL, 'stew@sjcustomjewelers.com', NULL, 'sjcustomjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Smith and Bevill', 'Ann', NULL, NULL, '9875 SW Beaverton-Hillsdale Hwy', NULL, 'Beaverton', 'OR', '97005', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', FALSE, 'Blocher Jewelers', NULL, 'Open Phone Ph#  724-481-5187', NULL, '283 State Rd 288', NULL, 'Ellwood City', 'PA', '16117', '(724) 944-6844', 'Mary DiCaprio', NULL, 'Tara Duncan', 'mary@blochers.com', 'Marketing@blocher.com or sales@blochers.com', 'www.blochers.com', 'blochers', NULL, FALSE, FALSE, 'No HOld', 'Blocher Buying Event Questionnaire (2).docx (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/HLifHGsqnLkZPFO8wRysHA/WuEs_XrfxsLVSv5cIVo9Vh7tmTNNjp5b_O30gfjRW9xa0-itnCDZ4qaX3_kIDu0qYByyeNuDha6yX4KgXsPn_4FxxTau9c12LwpW5kAbkg17-D6_6gaAjK7ywojXVYE5g5yrx7UZaD5yCprpTYlVnRo0xVFHS5l3RRfsohEGFj3p3wZhCdzVXDYvYFytvFGw/Ov8Pl3ptT_u85qy87pR1WC1Z0zT3_J3QRm9UnCgUIKM),Purchase of Precious Metals.pdf (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/dE7qzcf2uhyWfQ8Sxhs0UQ/7zpFFm4X5zZuXcbc8hLb39oHfDVxO8Fiqw0mHwp1BP00RlWT_jeT3Qz3warZuJkQxfQJgr59a4i_ticubWaWJZR87wQXYBmfcDaB9lWes4F1PP2DUhC-hMGwj7v2-BqRQwXMgf0u_aM05MhRh_b5S84DJ2PQWGjBD3PcrxNjh80/cBgrOkXIU_kswpZYKP8J4dFhJRAv2PMM80_ynKnJ0yE)'),
  ('BEB', TRUE, 'Dahlkemper''s Jewelry', 'Tanya', NULL, NULL, '6845 Peach Street', NULL, 'Erie', 'PA', '16509', NULL, 'katherine', NULL, NULL, 'kkd6845@gmail.com', NULL, 'www.dahlkempers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Garrick Jewelers', 'Tanya', '500 4 x 6', NULL, '1117 Eichelberger St', NULL, 'Hanover', 'PA', '17331', '(717) 637-1177', 'Rajen', 'Devon - devon@garrickjewelers.com', 'Rick - rfoye@garrickjewelers.com', 'repairs@garrickjewelers.com', NULL, 'garrickjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Henne Jewelers', 'Tanya', NULL, NULL, '5501 Walnut St #1', NULL, 'Pittsburg', 'PA', '15232', '(412) 682-0226', 'Harton Wolf
Andrea  Andrea@hennejewelers.com
Christine Spicuzza  c.spicuzza@hennejewelers.com>; Andrea Coen <Andrea@hennejewelers.com>

Christine is your best bet to get stuff done with Andrea is a limp noodle.', NULL, NULL, 'harton@hennejewelers.com', NULL, 'https://www.hennejewelers.com/', NULL, NULL, FALSE, FALSE, NULL, 'Henne logo white (3).png (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/CE0aGm9g7CQFTrr5SryQTQ/57glRPTAUo3jkVT61ChZtmND1vdrwIq5KegfB1HOAjzfs5oOSbYH7xJQ9icyg4VASi2_N5LyEceMdHp9q0obJha848koAbEbscaxv0HgOXj30fQjpny2VNma8TNEiJd9yfHr9-mF3DwyDPHXrbcNeA/hXd9niYtTrlA5GVED3lBjtbIJyvMqh7oTQL5eiLjifQ),Henne_Logo_WH.eps (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/LQFY3MNFIMQmD9dcWM96AQ/V3Me4lVom8BJO0cy0o831-qUY0SPFWEI2SyK_hjBkVYsz13-M7oZI72tGazanfzuJTcM1XDFqM2A60gMfbSaLEJsKDK4I_D7pKkE8RLnCQnXMd_FWsiUqt85Oyag3d3pAcRpm8n3AqdJUZEwCxf_8Q/b7dnZLgxkC0fcbSCuks5Jk9gzvyptAWdU02uxxxrVFw)'),
  ('BEB', FALSE, 'Indulgence  by Rhoda Forman', NULL, NULL, NULL, '369 Lancaster Ave', NULL, 'Haverford', 'PA', '19041', '(610) 896-1777', 'Stacey', NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('LIB', FALSE, 'Jem Jewelers', 'Tanya', 'Try these zips for next Jem jewelers after Aug 2023
We have never hit Bryn Mawr, Rosemont or Villanova.
Their zips are:
19010 
19085
19087
19428', NULL, '1409 Easton Road', NULL, 'Warrington', 'PA', '18976', '(215) 343-3385', 'Steven Petrillo', NULL, NULL, 'jewelersjem@aol.com', NULL, 'www.jem-jewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Leitzel''s Jewelry - Hershey', 'Tanya', NULL, NULL, '1661 East Chocolate Ave', NULL, 'Hershey', 'PA', '17033', '(717) 298-6725', 'Allison', NULL, NULL, 'allison@leitzelsjewelry.com  trevor@leitzelsjewelry.com', NULL, 'leitzelsjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Leitzel''s Jewelry - Myerstown', 'Tanya', NULL, NULL, '607 East Lincoln Ave', NULL, 'Myerstown', 'PA', '17067', '(717) 866-4274', 'Allison  - Trevor', NULL, NULL, 'allison@leitzelsjewelry.com  trevor@leitzelsjewelry.com', NULL, 'leitzelsjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Miska Jewelers', 'Tanya', NULL, NULL, '100 East College Ave', NULL, 'State College', 'PA', '16801', '814-237-7942', 'Steve', NULL, NULL, 'info@miskajewelers.com
steve@miskajewelers.com', NULL, 'miskajewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', FALSE, 'Musselman Jewelers', 'Tanya', NULL, NULL, '420 Main St', NULL, 'Bethlehem', 'PA', '18018', '(610) 866-3982', 'Tom Anderko', 'Sherri - Knows computer and Simply book me', NULL, 'musselmanjewelers420@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Simon & Co Jewelers', 'Ann', NULL, NULL, '502 Market Street', NULL, 'Kingston', 'PA', '18704', '(570) 718-1268', 'Contact names are Vic and Kevin....', NULL, NULL, 'simonco@epix.net', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('LIB', FALSE, 'Stacey Lee Boutique', NULL, 'Liberty Account  Scheduling Phone number 610-981-2015', NULL, '369 Lancaster Ave', NULL, 'Haverford', 'PA', '19041', '610-896-1777', 'Stacey Lee', NULL, NULL, 'staceylee3333@gmail.com  ninagrebs@gmail.com', NULL, 'https://shopstaceylee.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Warrick Jewelers', 'Tanya', NULL, NULL, '180 Old Swede Rd', NULL, 'Douglassville', 'PA', '19518', '(610) 385-0506', NULL, NULL, NULL, 'dorisp14k@comcast.net', NULL, 'www.warrickjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', FALSE, 'Williams', 'Tanya', NULL, NULL, '2960 Skippack Pike', NULL, 'Worcester', 'PA', '19490', '(610) 584-8283', 'Richie''s store', NULL, NULL, 'gemstonegirl89@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Skatell Jewelers', 'Tanya', NULL, NULL, '217 E Blackstock Rd', NULL, 'Spartanburg', 'SC', '29301', '(864) 576-6434', 'bethowens@gmail.com', NULL, NULL, NULL, NULL, 'www.skatellsjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Skatells Jewelers', 'Tanya', NULL, NULL, '743 Congaree Rd', NULL, 'Greenville', 'SC', '29607', '(864) 288-2501', NULL, NULL, NULL, NULL, NULL, 'www.shopskatells.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Sohn & McClure Jewelers', 'Tanya', 'Monday – Friday 10:00 am to 4:00 pm   Saturday by appt only', NULL, '334 East Bay Street', NULL, 'Charleston', 'SC', '29401', '(843) 853-3968', 'Karlen and Becky

	sohn.mcclure@aol.com,
sunnybrook.451050@yahoo.com', NULL, NULL, 'sohn.mcclure@aol.com', NULL, 'https://sohnandmcclure.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Turner''s Jewelers', NULL, NULL, NULL, '281 Applewood Center Pl', NULL, 'Seneca', 'SC', '29678', '(864) 882-5414', 'Jacob Turner Mark and Elaine', NULL, NULL, 'Jacob@turnersjewelers.com', NULL, 'turnersjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Bell Jewelers', 'Tanya', '500  4 x 6
10 - 6', NULL, '821 NW Broad Street', NULL, 'Murfeesboro', 'TN', '37129', '(615) 893-9162', 'Taylor Halliburton', NULL, 'Lisa Halliburton - Mother', 'Taylor@belljeweler.com', 'Lisa@belljeweler.com', 'Belljeweler.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Fountain City Jewelers', 'Tanya', NULL, NULL, '2802 Essary Dr', NULL, 'Knoxville', 'TN', '37918', '(865) 686-0502', 'Flower', NULL, NULL, 'Flower@fountaincityjewelers.com', NULL, 'fountaincityjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Gemstore', 'Ann', NULL, NULL, '9933 Kingston Pike', NULL, 'Knoxville', 'TN', '37922', '(865) 202-6999', 'Morgan Lester', NULL, 'Alice Rotar', 'Joe.Meli@jtv.com', 'alice.rotar@jtv.com', NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Heritage Jewelers', NULL, 'Last time got all print ready files', NULL, '108 Public Square E', NULL, 'Shelbyville', 'TN', '37160', '(931) 684-3115', 'Linda Brown  herjeweler@hotmail.com', NULL, NULL, 'https://www.herjeweler.com/', NULL, 'https://www.herjeweler.com', NULL, NULL, FALSE, FALSE, 'herjeweler@hotmail.com', NULL),
  ('BEB', TRUE, 'James Gattas Jewelers', 'Tanya', 'philip@gattasjewelers.com', NULL, '4900 Poplar Ave', NULL, 'Memphis', 'TN', '38117-5145', '(901) 767-9648', 'James', NULL, NULL, NULL, NULL, 'gattasjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Roberts Jewelers', 'Tanya', NULL, NULL, '405-G Vann Drive', NULL, 'Jackson', 'TN', '38305', '(731) 664-2257', 'mindi.case@yahoo.com   731-', NULL, NULL, 'mindi.case@yahoo.com', NULL, 'http://www.robertsjewelersinc.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'The Jewelry Emporium', 'Tanya', NULL, NULL, '377 West Jackson Ave. #20', NULL, 'Cookesville', 'TN', '38501', '(931) 528-1234', 'Trisha', NULL, NULL, NULL, NULL, 'www.getmyring.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Treasure Jewelers', 'Tanya', 'From RJO - Was Larrys that Tanya got for him.  Now Tanyas account - that tiffany will be doing', NULL, '177 Foothills Mall Dr', NULL, 'Maryville', 'TN', '37801', '865-983-0987', 'Alex Jooma - Moble 865-405-7175', NULL, NULL, 'azizjooma110@gmail.com', NULL, 'treasuresjewelerstn.com', NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Avonlea Jewelers', 'Ann', NULL, NULL, '84 N LHS Drive', NULL, 'Lumberton', 'TX', '77657', '409-227-0418', 'William', NULL, 'Store Est 2018.  Call that came on on Max''s phone', NULL, NULL, 'https://www.avonleajewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Chris Dostal''s Designs in Fine Jewelry', NULL, 'Tues - Fri 10 - 5:30
Sat 10 - 4', NULL, '940 3rd St', NULL, 'Rosenberg', 'TX', '77471', '(281) 342-2112', 'Gina - Mgr
Nedra - wife/Owner
Chris is owner', NULL, NULL, 'cdostal@dostalsjewelry.com   info@dostalsjewelry.com', NULL, 'dostalsjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Di''Amore Fine Jewelers', 'Ann', NULL, NULL, '4541 W. Waco Dr', NULL, 'Waco', 'TX', '76710', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Eaton Custom Jewelers', NULL, NULL, NULL, '5200 McDermott Rd Suite 205', NULL, 'Plano', 'TX', '75024', '(972) 335-6500', 'Dave', NULL, NULL, 'contact@eatoncustomjewelers.com', NULL, 'https://www.eatoncustomjewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Franzetti Jewelers', NULL, 'Store Hours
MONDAY:
Closed
TUESDAY - FRIDAY:
10:00 am - 5:00 pm
SATURDAY:
10:00 am - 3:00 pm
SUNDAY:
Closed', NULL, '3707 Kerbey Lane', NULL, 'Austin', 'TX', '78731', NULL, 'Tony', NULL, NULL, 'tony@franzettijewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Green Brothers', 'Ann', 'RJO', NULL, '2121 Avenue G', NULL, 'Bay City', 'TX', '77414', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Hogue''s Jewelry', NULL, 'Need logo', NULL, '202 N Washington St', NULL, 'Beeville', 'TX', '78102', '(361) 358-3859', 'Debbie Parsons', NULL, NULL, 'hoguesjewelry@gmail.com', NULL, 'hoguesjewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Holder''s Jewelers', 'Tanya', '500 5 x 7', NULL, '2408 Jack Street', 'Parker Square', 'Wichita Falls', 'TX', '76308', '(940) 691-1721', 'Teresa Menchaca <teresa.holdersjewelers@yahoo.com>', NULL, NULL, 'teresa.holdersjewelers@yahoo.com', NULL, 'https://www.holdersjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Houston Jewelry', 'Ann', NULL, NULL, '9521 WESTHEIMER RD', NULL, 'HOUSTON', 'TX', '77063', '(713) 784-1000', 'Rex', NULL, NULL, 'houstonjewelry.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Jim Bartlett Fine Jewelry', 'Alex', 'Rjo', NULL, '2002 Judson Rd #101', NULL, 'Longview', 'tx', '75605', '(903) 758-4367', 'Holley', 'Jim Bartlett - owner', 'Wendy M', 'HolleyK@bartlettfinejewelry.com', 'WendyM@bartlettfinejewelry.com', 'www.bartlettfinejewelry.com', NULL, '(903) 437-9681', FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Jim Bartlett Fine Jewelry', NULL, NULL, NULL, '2002 Judson Rd #101', NULL, 'Longview', 'TX', '75605', '(903) 758-4367', 'Amy', 'WendyM@bartlettfinejewelry.comJim@bartlettfinejewelry.com', 'HolleyK@bartlettfinejewelry.com', 'Wendy@bartlettfinejewelry.com', 'Amy@bartlettfinejewelry.com', 'www.bartlettfinejewelry.com', 'bartlett', NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Loggins Jewelers', NULL, NULL, NULL, '14015 Southwest Fwy', NULL, 'Sugar Land', 'TX', '77478', '(281) 242-2900', NULL, NULL, NULL, 'jloggins.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', FALSE, 'Moore Jewelers', NULL, 'Stores Hours - 11 - 6pm', '11 - 6', '7815 McPherson Rd # 105', NULL, 'Laredo', 'TX', '78045', '956-724-5969', 'Lauren Moore', 'Lauren Moore- 956-4892815', NULL, 'lauren.moorejewelers@gmail.com', NULL, 'www.moore-jewelers.com', NULL, '956-724-5969', FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Pagel and Sons', 'Ann', 'RJO', NULL, '2102 S. W.S. Young Drive', NULL, 'Killeen', 'TX', '76543', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Ray Harp Jewelers', 'Tiff', NULL, NULL, '108 N East St', NULL, 'Atlanta', 'TX', '75551', '(903) 796-7185', 'Tamy', NULL, NULL, 'rayharpjewelers@yahoo.com', NULL, 'rayharpjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Sovereign Jewelry Company', 'Ann', NULL, NULL, '207 S Jennings Ave', NULL, 'Fort Worth', 'TX', '76104', '(817) 885-7848', 'brandojeweler@yahoo.com', NULL, NULL, 'brandojeweler@yahoo.com', NULL, 'www.sovereignjewelryco.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Thackers Jewelers', NULL, NULL, NULL, '6120  82nd street', NULL, 'Lubbock', 'Tx', '79424', '(806) 794-7766', 'www.tammys-jewelry.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Unique Jewels', 'Ann', NULL, NULL, '400 W Bay Area Blvd #C', NULL, 'Webster', 'TX', '77598', '(281) 332-6552', 'Kim', 'Kim - direct phone is 832-6874264', NULL, 'kim@uniquejewelshouston.com', NULL, 'https://www.uniquejewelshouston.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Whitestone Fine Jewelry', NULL, NULL, NULL, '601 East Whitestone Blvd #112', NULL, 'Cedar Park', 'TX', '78613', '(512) 259-9430', NULL, NULL, NULL, 'kristina@whitestonefinejewelry.com', NULL, 'whitestonefinejewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Zembar Jewelers', NULL, 'Lead from phone call Sept 2025 Store Est 2018.  Call that came on on Max''s phone', NULL, '84 N. LHS Drive', NULL, 'Lumberton', 'TX', '77657', '409-227-0418', 'William', NULL, NULL, 'meganklub@gmail.com', NULL, 'https://www.avonleajewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Bennion Jewelers', NULL, 'Bill is owner. bill@bennionjewelers.com Need to send everything to tracy@bennionjewelers.com  Derrick@bennionjewelers.com
Tuesday	10AM–5:30PM
Wednesday10AM–5:30PM
Thursday10AM–5:30PM
Friday	10AM–5:30PM
Saturday	10AM–4PM
Sunday	Closed
Monday	10AM–5:30PM', NULL, '15 W S Temple', '#120', 'Salt Lake City', 'UT', '84101', '(801) 364-3667', 'tracy', NULL, NULL, 'tracy@bennionjewelers.com', NULL, 'www.bennionjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Duke''s Jewelers', 'Ann', NULL, NULL, '220 S Main St', NULL, 'Springville', 'UT', '84663', '(801) 489-4221', 'Kim', 'annie@dukesjewelers.com

Annie Daniels', NULL, 'kim@dukesjewelers.com', NULL, 'dukesjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Forever Young Fine Jewelers', 'Ann', NULL, NULL, '41 N Main St', NULL, 'St. George', 'UT', '84770', '(435) 673-2471', 'Megan Young', NULL, NULL, 'megan@foreveryoungfinejewelers.com', NULL, 'https://foreveryoungfinejewelers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Jonathan''s Jewelry', 'Tiff', 'Buy is scheduled.  They require finger print and ID - no Hold', NULL, '6910 S Highland Dr #5', NULL, 'Cottonwood Heights', 'UT', '84121', '(801) 943-0303', 'Bryan', NULL, NULL, 'bryan@jonathansjewelry.com', NULL, 'www.jonathansjewelry.com', NULL, NULL, FALSE, FALSE, 'No Hold', 'jonathans already has  the license.  There is not a police hold period.  We do have requirements for fingerprints and ID for the state database'),
  ('BEB', TRUE, 'Payne Anthony Creative Jewelers', 'Tiff', 'Sister store to Jonathan''s', NULL, '329 Trolley SQ', NULL, 'Salt Lake City', 'UT', '84102', '(801) 328-0944', 'Bryan', NULL, NULL, 'bryan@jonathansjewelry.com', 'bryan@jonathansjewelry.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'SE Needman Jewelers', 'Ann', NULL, NULL, '141 North Main Street', NULL, 'Logan', 'UT', '84321', '(435) 752-7149', 'Sylvan Needham', NULL, NULL, 'sylvan@seneedham.com', NULL, 'https://www.seneedham.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Burkes Fine Jewelers- Kilmarnock', NULL, 'Kelly store', '10 - 5', '86 S Main Street', NULL, 'Kilmarnock', 'VA', '22482', '(804) 435-1302', 'Karen Burke  cell # 804-7615983', NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Burkes Fine Jewelers- Warsaw', NULL, 'Kelly Store', '10 - 5', '128 Main Street', NULL, 'Warsaw', 'VA', '22572', '(804) 250-2020', 'Karen Burke  cell # 804-7615983', NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Crown Jewelers', 'Ann', 'Usual order is 300 to 500 4 x 6', NULL, '200 William St.', NULL, 'Fredericksburg', 'VA', '22401', '(540) 373-4421', 'David', NULL, NULL, 'crownjewelers@verizon.net', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Goodman & Sons Jewelers - Hampton', 'Tiff', '(757) 317-1356
2018 Coliseum Drive
Hampton, VA 23666    goodmanandsons.com', NULL, '2018 Coliseum Dr', NULL, 'Hampton', 'VA', '23666', '(757) 838-2328', 'New Newspaper contact - teresa.eure@virginiamedia.com  She takes care of both newspaper

The price of the Spadea went up because it has to run in the Daily Press AND VA Pilot for Sunday $20,000.  Week day is $15,000', NULL, NULL, 'brittany@goodmanandsons.com', NULL, NULL, 'goodman', NULL, FALSE, FALSE, '21 day', NULL),
  ('BEB', TRUE, 'Goodman & Sons Jewelers - Williamsburg', 'Tiff', '4640 Monticello Ave, Williamsburg, VA 23188  (757) 229-5388
goodmanandsons.com     Newspaper is   Virigina Media   Vikkimarie 
10,900
Spadea- (3 col) 4.915” x 21"
Post it notes- Finished Trim Size: 3”x3” / Bleed Size: 3.15”x3.15” / Safe Image Area: 2.85”x2.85”
Full Page- (6 col) 10” x 21”
Front Page Strip- (6 col) 10”x3”
eNewspaper- 160x600, 728x90, 320x50 (mobile,tablet,desktop) 

Please let me know if you have any questions or need further assistance! Happy to help!', NULL, '4640 Monticello Ave', 'Ste 11A', 'Williamsburg', 'VA', '23188', '(757) 229-5388', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, '21 day', NULL),
  ('BEB', FALSE, 'Grace Marie Jewelry & Design', 'Tanya', NULL, NULL, '825 Main Street', NULL, 'Lynchburg', 'VA', '24504', '(434) 386-8422', 'Elise Rose
RJO Account', NULL, NULL, 'elise@gracemariejewelers.com', NULL, 'www.gracemariejewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('LIB', TRUE, 'Hooker and Co. Fine', 'Tiff', '11 - 5', NULL, '17 Church Ave SW 1st Floor', NULL, 'Roanoke', 'VA', '24011', '540) 566-3108', 'Jason Hooker  540-553-1968', NULL, NULL, 'jason@refinedjewells.com', NULL, 'hookerfinejewelers.com', NULL, '540-596-5491', FALSE, FALSE, NULL, NULL),
  ('LIB', FALSE, 'Jewelry and Watch Works', NULL, 'Ann''s account', NULL, '8071 Mechanicsville Turnpike', NULL, 'Mechanicsville', 'VA', '23111', '(804) 723-5312', 'George', NULL, NULL, 'George@Jewelrywatchworks.com', NULL, 'Jewelrywatchworks.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Mystique Fine Jewelry Designs', 'Ann', NULL, NULL, '123 S. Fairfax Street', NULL, 'Alexandria', 'VA', '22314', '(703) 836-1401', 'Elizabeth Mandros', 'Alexandria', NULL, 'marketing@mystiquejewelers.com', 'emandros@mystiquejewelers.com', 'mystiquejewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Mystique Jewelers of Middleburg', 'Ann', NULL, NULL, '112 W Washington St', '#102', 'Middleburg', 'VA', '20118', '(540) 687-3100', 'Elizabeth Mandros', NULL, NULL, 'emandros@mystiquejewelers.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Reines and Rogers Jewelers', 'Tanya', NULL, NULL, '240 Twenty-Ninth Place Court', NULL, 'Charlottesville', 'VA', '22901', '(434) 977-8450', 'Jessica 434-977-8448', NULL, NULL, 'jessica@reinesandrogers.com', NULL, 'www.reinesandrogers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'RM Johnson & Sons Jewelers', NULL, NULL, NULL, '10 South College Ave', NULL, 'Salem', 'VA', '24153', '540-389-4783', 'R Mack JohnsonIII and Jane Johnson', NULL, NULL, 'rmjohnsonjewelers@gmail.com', NULL, 'rmjohnson.com', 'rmjohnson', NULL, FALSE, FALSE, 'No Hold', NULL),
  ('BEB', TRUE, 'Today''s Cargo', 'Ann', NULL, NULL, '117 N Fairfax St #1', NULL, 'Alexandria', 'VA', '22314', '(703) 836-6866', 'Carla M. Clarke', NULL, NULL, 'jewelry@todayscargo.com', NULL, 'www.todayscargo.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Diamonds and More', 'Tiff', NULL, NULL, '7 Center Street', NULL, 'Rutland', 'VT', '05701', '802/773-7277', 'Ivan C Rochon', NULL, NULL, 'ivansdiamonds@aol.com', NULL, 'diamondsandmore.us', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Renaissance Fine Jewelry', 'Ann', '500 4 x 6', NULL, '151 Main St', NULL, 'Brattleboro', 'VT', '05301', '(802) 251-0600', 'Ann Marie is head of marketing
             Caitlyn Wilkinson is the owner', NULL, NULL, 'caitlyn@vermontjewel.com, contactus@vermontjewel.com', NULL, 'vermontjewel.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Blue Heron Jewelry Co', 'Ann', NULL, NULL, 'PO BOX 371', NULL, 'Poulsbo', 'WA', '98370', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Celebration Jewelers', 'Ann', '1000 5 x 7
Craig@thecelebrationjewelers.com


Tuesday: 10:00am-5:30pm
Wednesday: 10:00am-5:30pm
Thursday: 10:00am-5:30pm
Friday: 10:00am-5:30pm
Saturday: 10:00am-3:00pm
Sunday & Monday: Closed', NULL, '2210 W Main St.', '#111', 'Battle Ground', 'WA', '98604', '(360) 723-0867', 'craig', 'Lisa', NULL, 'Craig@thecelebrationjewelers.com', NULL, 'thecelebrationjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Clark''s Jewelers', 'Ann', NULL, NULL, '6946 Kimball Dr,', NULL, 'Gig Harbor', 'WA', '98335', '(253) 851-5395', 'Michael', NULL, NULL, 'Clarksjewelers@comcast.ne', NULL, 'www.clarksjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Cline Jewelers', 'Ann', NULL, NULL, '105 5th Ave S', NULL, 'Edmonds', 'WA', '98020', '(425) 673-9090', 'Andy', NULL, NULL, 'Andy@clinejewelers.com', NULL, 'http://www.clinejewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Comstock Jewelers', 'Ann', NULL, NULL, '411 Main St', NULL, 'Edmonds', 'WA', '98020', '(425) 778-4666', NULL, NULL, NULL, NULL, NULL, 'www.comstockjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Falkenbergs Jewelers', 'Ann', 'Shauna
6 East Main Street
Walla Walla, WA  99362
(509) 525-6060
500 5 x 7', NULL, '6 East Main Street', NULL, 'Walla Walla', 'WA', '99362', '(509) 525-6060', 'info@falkenbergs.com', NULL, NULL, 'info@falkenbergs.com', NULL, 'www.falkenbergs.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Federal Way Custom Jewelers', 'Ann', NULL, NULL, '1810 S 320th St Suite B', NULL, 'Federal Way', 'WA', '98003', '(253) 839-7389', 'Brandon Jenkins Moak', NULL, NULL, 'brandon@fwcj.com', NULL, 'fwcj.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  (NULL, TRUE, 'Jewelry Design Center', 'Ann', 'RJO', NULL, '350 N Louisiana St A', NULL, 'Kennewick', 'WA', '99336', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (NULL, TRUE, 'Jewelry Design Center', 'Ann', 'RJO', NULL, '821 N. Division Street', NULL, 'Spokane', 'WA', '99202', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (NULL, TRUE, 'Ken Walker Jewelers', 'Ann', NULL, NULL, '4912 Point Fosdick Drive NW', NULL, 'Gig Harbor', 'WA', '98335', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Marlow''s Fine Jewelers', 'Ann', NULL, NULL, '1440 NW Gilman Blvd', 'M4', 'Issaquah', 'WA', '98027', '(425) 270-3411', 'Debbie Marlow', NULL, NULL, 'dmarlow37@hotmail.com', NULL, 'marlowsfinejewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('JLC', TRUE, 'Miller''s Fine Jewelers', 'Ann', NULL, '10 - 5', '122 W Third Ave', NULL, 'Moses Lake', 'WA', '98837', '(509) 765-6262', 'Todd L', NULL, NULL, 'amandaf@nwi.net', 'toddl@nwi.net', 'www.millersfinejewelers.com', 'miller', NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Neeter House of Luxury', 'Ann', NULL, NULL, '21 Bellwether Way #107', NULL, 'Bellingham', 'WA', '98225', '(360) 778-1613', 'John Neeter', NULL, NULL, 'john@neeterhouseofluxury.com', NULL, 'neeterhouseofluxury.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Panowicz Jewelers', 'Tanya', 'Never doing Seattle TImes again!  

3300 9 x 6. 200 sent to store and 3100 to ApexMailing House Address:
Apex Mailing Services
2827 29th Ave SW
Tumwater, WA 98512
(360) 352-0309', NULL, '111 Market St NE', 'Ste 104', 'Olympia', 'WA', '98501', '(360) 357-4943', 'Leslie

Newspaper contact - Diane Stojakovich  dstojakovich@mcclathy.com', NULL, NULL, 'leslie@panowicz.com', NULL, 'www.panowicz.com', 'panowicz', '(360) 529-5601', FALSE, FALSE, 'no hold', NULL),
  ('BEB', TRUE, 'The Jewelry Source', 'Ann', NULL, NULL, '15603 Main Street #101', NULL, 'Mill Creek', 'WA', '98012', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Tom Poe Diamonds', NULL, NULL, NULL, '1343 Garrett St.', 'Suite B', 'Enumclaw', 'WA', '98022', '(360) 802-2200', NULL, NULL, NULL, 'tompoediamond@aol.com', NULL, 'www.tompoediamonds.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Tracy Jewelers', 'Ann', 'Online payment for Spoksane Review   $6039.91
URL - https://ssr.navigahub.com/portal/client/ssr
 login - user''s email
 pw ->
D!amond1
So, if you did a 2 page Spadea TWICE in a year, I could get the price down to $6,039.91 for each run.', NULL, '106 N. Evergreen', NULL, 'Spokane', 'WA', '99216', '(509) 893-2929', 'Jen Jensen', 'sean - owner', NULL, 'Jenkjensen@yahoo.com', 'sean@tracyjewelers.com', 'www.tracyjewelers.com', 'tracy1', NULL, FALSE, FALSE, '30 day', NULL),
  ('BEB', TRUE, 'William and Son Fine Jewelry', 'Ann', NULL, NULL, '210 NE 4th Ave', NULL, 'Camas', 'WA', '98607', '(360) 210-5555', 'Steven', NULL, NULL, 'williamandsonjewelers@yahoo.com', NULL, 'williamandsonjewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Avenue Jewelers', 'Ann', NULL, '10 - 6 and 10 - 4', '303 E College Ave', NULL, 'Appleton', 'WI', '54911', NULL, 'Megan klubertanz', NULL, NULL, 'megan@avenuejewelers.com', NULL, 'avenuejewelers.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Bergey Jewelry', 'Radica', 'RJO', 'T-F 9 - 5:30 Sat - 9 - 12', '111 S main St', NULL, 'Oregon', 'WI', '53575', '608-835-3698', 'Jill Hoff - Owner', NULL, NULL, 'jill@Bergeyjewelry.com', NULL, 'bergeyjewelry.com', NULL, NULL, NULL, NULL, NULL, NULL),
  ('BEB', TRUE, 'Husar''s house of Fine Diamonds', 'Tanya', NULL, NULL, '131 N. Main St', 'PO Box 207', 'West Bend', 'WI', '53095', '(262) 334-3453', 'mary@husars.com
mike@husars.com', NULL, NULL, 'Michellelehman@husars.com', NULL, 'husars.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Lasker Jewelers - Eau Claire', 'Tanya', 'Harris will get the $500 bonus for this one', NULL, '3705 Oakwood Mall Drive', NULL, 'Eau Claire', 'WI', '54701', '(715) 835-5914', 'Nicole', NULL, NULL, 'Nicole@laskers.com', NULL, 'https://laskers.com/company/locations/eau-claire-wi/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Mark Jewellers', 'Ann', 'Ann''s - From RJO show 8/23', NULL, '1205 Caledonia St', NULL, 'La Crosse', 'WI', '54603', '(608) 785-0110', 'Karla', NULL, NULL, 'Karla@markjewellers.com', NULL, 'https://www.markjewellers.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', FALSE, 'Rasmussen Diamonds', NULL, NULL, NULL, '6220 Washington Ave', NULL, 'Racine', 'WI', '53406', '(262) 884-9474', 'katrina@rasmussendiamonds.com', NULL, NULL, 'katrina@rasmussendiamonds.com', NULL, 'rasmussendiamonds.com', 'Rasmussen', NULL, FALSE, FALSE, NULL, 'Rasmussen Diamonds  Buying Event Questionnaire.docx (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/dfRSmtO61mWL_jw_RkKO1g/CjK3sZj20SUZwwep3pfyaMIKqV2QIMRphJV9ybztcSeGQGVIkOanIGW24sLAimpXdu4vImIdLyURo1YS4xmJs2CkYOYxSeDUc1iePK6tz0FgNI6LgHWLk5UuZVR6ty5x59dzQEpAJfd2-CjCPBtpLgZiVwc_XSS6KxqC97cI3eP2y4S76Jv5GaHdyQdwBfdX/d0O5ROlEM59ASuclH973a8fBWtDusIOceMHSpYlf9Gs)'),
  ('BEB', FALSE, 'Sather Jewelry', 'Tanya', 'rjo', NULL, '126 Walnut St', NULL, 'Spooner', 'WI', '54801', '(715) 635-2418', 'Bob and Janet Otto', NULL, NULL, 'satherjewelrywi@gmail.com', NULL, 'satherjewelrywi.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Scanlan Jewelers', 'Ann', NULL, NULL, '2304 Lineville Rd', 'Ste 109', 'Green Bay', 'WI', '54313', '(920) 465-9829', 'Wendy 920-471-2546', NULL, NULL, 'scanlanjewelers1903@gmail.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'TQ Diamonds', 'Ann', NULL, NULL, '7058 Mineral Point Road', NULL, 'Madison', 'WI', '53717', '(608) 833-4500', NULL, NULL, NULL, 'Jessica@tqdiamonds.com', NULL, 'www.tqdiamonds.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Wickersham Jewelry -  3 stores', 'Ann', 'Wickersham Jewelry
Cedar Creek
10209 Market St.
Rothschild, WI 54474
(715) 355-5987

Wickersham Jewelry 
1921 N. Central Ave.
Marshfield, WI 54449
(715) 384-4102

Wickersham Jewelry 
Cedar Wood Plaza
1419 Lincoln St.
Rhinelander, WI 54501
(715) 362-2822', NULL, '10209 Market St.', NULL, 'Rothschild', 'WI', '54474', '(715) 355-5987', 'Deb@wickershamjewelry.com  715 574 1204', NULL, NULL, 'Deb@wickershamjewelry.com', NULL, 'https://www.wickershamjewelry.com/', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Wolf & Stag Fine Jewelry', 'Radica', 'This was a Kelly store', '12 - 5 Tuesday - SAT', '135 S. Washington St #3', NULL, 'St Croix Falls', 'WI', '54024', '715-475-9784', 'LaTischa Franzmeier', NULL, NULL, 'contact@wolf-stag-jewelry.com', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'EK Jewelers', 'Tanya', '217 S. Gillette Avenue
Gillette, WY 82716
 
Contact
(307) 363-4010
yourelegantkreations@gmail.com
 
10 - 5', NULL, '304 S. Gillette Ave', NULL, 'Gillette', 'WY', '82716', '(307) 363-4010', 'Erica Kissack', NULL, NULL, 'yourelegantkreations@gmail.com', NULL, 'ekjewelers.com', NULL, '307-323-3394', FALSE, FALSE, NULL, 'ek jewelers png black .png (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/9kRU0s6p-jF17QPFFvr1wQ/Voeu_mY6jfIBvY-AAxnGFcSTp3yQl_XHrNLe1ZTguTvdgbra_7lI78ekgx7eHKSeJka0OIvVf3FjF2VoWSJLSkqcPmFqidNBH4xbnRaw2qHgZyHVE88fcrXEB7UZeWkywyAQ0PWm8IP-eD7drLdvqFhdz63fIudaR7Er8u292Tk/J_danhlwbqPbHdxq4Wi6xf72U3cml5YaA3oOeQYAST4),EKreations Big Dia Logo PNG.png (https://v5.airtableusercontent.com/v3/u/42/42/1750363200000/yRfjKeDUKDjQtyyoXW2bAA/wEZ-woSGgjUJDCgRnL6BW8HqDGGTEo6csmOVzo9wU0ICJBikaVJXusaSIn0bRKYrc_bfj8LCMJMlo8Njc-k0ut_2mA1-9LFrHBYgBVqW13Crt44RpQ7HdYkBv6BMeOA96lSDDB7GNgjmDIL0LSMNL8_8Pm1_kOgCNYq8D6g0EbM/bTxgJPMcAitk5fI_6bx-_HW-gbx-4W6qzPZDHINdaM4)'),
  ('BEB', FALSE, 'Marshall Jewelry', NULL, NULL, NULL, '1103 E Boxelder Rd', '# C', 'Gillette', 'WY', '82718', '(307) 686-6666', NULL, NULL, NULL, 'Marshall_diamonds@yahoo.com', NULL, 'http://www.marshalljewelry.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'WyoBranded Gems and Jewels', 'Tanya', 'JCK', NULL, '915 East Richards Street', NULL, 'Douglas', 'WY', '82633', '(307) 358-0018', 'Susan Grey', NULL, NULL, 'susan@wyobranded.com', NULL, 'www.wyobranded.com', NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('BEB', TRUE, 'Hudson Valley Goldsmith', 'Tiff', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL),
  ('LIB', TRUE, 'James test', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '98837', NULL, NULL, NULL, NULL, 'jtwelsch@cox.net', NULL, NULL, NULL, NULL, FALSE, FALSE, NULL, NULL);
