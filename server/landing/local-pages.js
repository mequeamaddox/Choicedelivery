// Area and service pages for search (choicedeliverysc.com/<slug>). Each page has its own wording so it
// answers what people in that area or with that need search for. After editing, run
//   npm run build:landing-pages && npm run build:landing-css
// which writes landing/<slug>.html and landing/sitemap.xml.

const AREAS = [
  {
    slug: 'courier-lexington-sc',
    nav: 'Lexington',
    title: 'Courier & Same-Day Delivery in Lexington, SC',
    description: 'Same-day courier and rush delivery in Lexington, SC. Pickups and drop-offs across Lexington, Red Bank, Gilbert and Lake Murray, with live tracking and photo proof. Get an instant quote.',
    h1: 'Courier and same-day delivery in Lexington, SC',
    intro: 'Lexington is about 15 miles west of downtown Columbia, and we run there every day. Whether you need something picked up off Sunset Boulevard and taken across town, or brought out from Columbia to a shop on Main Street, we can have a driver on it today.',
    sections: [
      ['Around Lexington and the lake', 'We pick up and deliver throughout Lexington, Red Bank, Gilbert, Oak Grove and the Lake Murray side of town, and between Lexington and Columbia, West Columbia, Cayce and Irmo. Trips into Columbia usually run straight down US-378 or I-20.'],
      ['What we deliver around Lexington', 'Parts for repair shops and dealerships, print jobs and signs, flowers and gifts, supplies for contractors, and boxes for small retailers and online sellers who need something to a customer today instead of in three days.'],
    ],
    faqs: [
      ['How fast can you deliver in Lexington?', 'With Rush, a driver picks up right away and drives straight there, usually about 2 hours or less for trips around Lexington and into Columbia. Standard deliveries are same day.'],
      ['Do you deliver from Lexington to other cities?', 'Yes. We deliver from the Midlands to anywhere in South Carolina, plus nearby North Carolina and Georgia. Your quote shows the price for the exact route.'],
    ],
  },
  {
    slug: 'courier-irmo-chapin-sc',
    nav: 'Irmo & Chapin',
    title: 'Courier & Same-Day Delivery in Irmo and Chapin, SC',
    description: 'Same-day courier and rush delivery in Irmo, Chapin, Ballentine and Harbison. Live tracking, photo and signature proof, and an instant price online.',
    h1: 'Courier and same-day delivery in Irmo and Chapin, SC',
    intro: 'From Harbison and St. Andrews out to Ballentine and Chapin, we cover the I-26 corridor northwest of Columbia. Book online, see your price right away, and follow your driver on the map.',
    sections: [
      ['Covering the I-26 corridor', 'We pick up and deliver in Irmo, Harbison, Seven Oaks, Ballentine, Chapin and the north shore of Lake Murray, and between those areas and Columbia, Lexington and the rest of the Midlands.'],
      ['Good fits for us', 'Shops along Harbison Boulevard and Lake Murray Boulevard, offices off Bush River Road, contractors and supply houses, and anyone who needs a part, package or document across town today.'],
    ],
    faqs: [
      ['Do you pick up in Chapin?', 'Yes. Chapin is one of our regular areas. Enter your pickup and delivery addresses for an instant price.'],
      ['Can I track my delivery?', 'Yes. You get a tracking link with the driver\'s live location, and every delivery is confirmed with a photo, signature and GPS location.'],
    ],
  },
  {
    slug: 'courier-west-columbia-cayce-sc',
    nav: 'West Columbia & Cayce',
    title: 'Courier & Same-Day Delivery in West Columbia and Cayce, SC',
    description: 'Fast local courier service in West Columbia, Cayce, Springdale and Pine Ridge. Rush pickups, same-day delivery, live tracking and photo proof. Instant online quote.',
    h1: 'Courier and same-day delivery in West Columbia and Cayce, SC',
    intro: 'West Columbia and Cayce sit right across the river from downtown, so most trips here are short, quick runs. When something has to get across the Congaree today, we can usually pick it up right away.',
    sections: [
      ['Right across the river', 'We pick up and deliver throughout West Columbia, Cayce, Springdale, Pine Ridge and the airport area, and across the river to downtown Columbia, the Vista and the rest of the Midlands.'],
      ['Short trips, quick turnaround', 'Local runs like these are where Rush shines: a driver heads to your pickup right away and drives straight to the drop-off, with no other stops in between.'],
    ],
    faqs: [
      ['How much is a delivery from West Columbia to downtown Columbia?', 'It depends on the vehicle and the exact addresses. Enter them in our instant quote to see your price before you book.'],
      ['Are you open on weekends?', 'Yes. We run 8 AM to 10 PM, seven days a week.'],
    ],
  },
  {
    slug: 'courier-blythewood-sc',
    nav: 'Blythewood & Northeast',
    title: 'Courier & Same-Day Delivery in Blythewood and Northeast Columbia, SC',
    description: 'Same-day courier and rush delivery in Blythewood, Killian Road, Sandhills and Northeast Columbia. Live tracking and photo proof. Get an instant quote online.',
    h1: 'Courier and same-day delivery in Blythewood and Northeast Columbia',
    intro: 'Northeast Columbia keeps growing, from the Sandhills and Killian Road up to Blythewood along I-77. We pick up and deliver across the area every day, with an instant price online and live tracking on every order.',
    sections: [
      ['Covering the I-77 corridor', 'We serve Blythewood, Killian Road, the Sandhills, Pontiac, Elgin and the rest of Northeast Columbia, plus trips between there and downtown, Lexington, Irmo and the rest of South Carolina.'],
      ['Built for businesses on the move', 'Warehouses, contractors, repair shops and offices in the area use same-day couriers for parts, supplies and paperwork that can\'t wait for a shipping carrier.'],
    ],
    faqs: [
      ['Do you deliver from Blythewood to Charlotte?', 'Yes. We deliver into nearby North Carolina, including the Charlotte area. Your quote shows the price and how long the drive takes.'],
      ['What vehicles do you have?', 'Car, minivan and pickup truck, so we can take anything from an envelope to bulky items. No single piece over 75 lbs.'],
    ],
  },
];

const SERVICES = [
  {
    slug: 'same-day-delivery-columbia-sc',
    nav: 'Same-day delivery',
    title: 'Same-Day Delivery Service in Columbia, SC',
    description: 'Same-day delivery from Columbia and the Midlands to anywhere in South Carolina, plus nearby NC and GA. Instant online price, live tracking and photo proof of delivery.',
    h1: 'Same-day delivery from Columbia, SC',
    intro: 'When shipping carriers say "two to three business days," we say today. Choice Delivery picks up in Columbia and the Midlands and delivers the same day, across town or across the state.',
    sections: [
      ['Across town or across the state', 'Most of our runs stay in the Midlands, but we also deliver to Charleston, Greenville, Spartanburg, Florence, Rock Hill, Myrtle Beach and anywhere else in South Carolina, plus nearby North Carolina and Georgia. One driver takes your shipment the whole way.'],
      ['Priced by your route', 'Your price is based on the vehicle and the driving distance, and you can see exactly what each part is for before you book. No calling around for a quote.'],
    ],
    faqs: [
      ['What\'s the difference between standard and Rush?', 'Standard is delivered the same day. With Rush, a driver picks up right away and drives straight there, about 2 hours for trips within 50 miles.'],
      ['How late can I book?', 'We run 8 AM to 10 PM every day. For long trips, booking earlier in the day gives the driver time to get there.'],
    ],
  },
  {
    slug: 'rush-delivery-columbia-sc',
    nav: 'Rush delivery',
    title: 'Rush Courier Delivery in Columbia, SC (About 2 Hours)',
    description: 'Rush courier service in Columbia, SC: a driver picks up right away and drives straight to the drop-off, about 2 hours for local trips. Live tracking and photo proof.',
    h1: 'Rush delivery in Columbia, SC',
    intro: 'Forgot something? Customer waiting? With Rush, a driver heads to your pickup right away and drives straight to the drop-off. No stops for other orders in between.',
    sections: [
      ['About 2 hours around Columbia', 'For trips within about 50 miles of the pickup, Rush delivery usually takes about 2 hours or less from booking. Longer trips take as long as the drive, and your quote shows the estimate before you book.'],
      ['Follow it the whole way', 'You get a tracking link to watch the driver on the map, and we confirm the delivery with a photo, signature and GPS location so you know exactly when it arrived and who signed for it.'],
    ],
    faqs: [
      ['How much does Rush cost?', 'Rush adds a fee to the regular price, starting at $25 for local trips. Your quote shows the exact amount.'],
      ['Can I book Rush at night or on weekends?', 'Yes, anytime between 8 AM and 10 PM, seven days a week.'],
    ],
  },
  {
    slug: 'auto-parts-delivery-columbia-sc',
    nav: 'Auto parts delivery',
    title: 'Auto Parts Delivery in Columbia, SC | Same-Day Parts Runs',
    description: 'Same-day and rush auto parts delivery for repair shops, dealerships and parts stores in Columbia, Lexington and the Midlands. Car, minivan or pickup truck.',
    h1: 'Auto parts delivery in Columbia and the Midlands',
    intro: 'A car on the lift waiting on a part is money lost. We run parts between stores, warehouses, dealerships and repair shops across the Midlands, so your techs stay working instead of driving.',
    sections: [
      ['For shops, dealers and parts stores', 'Independent repair shops, body shops, dealerships, parts stores and mobile mechanics use us for same-day parts runs, store-to-store transfers and returns. Book online in a minute, or call and we\'ll book it for you.'],
      ['The right vehicle for the part', 'A car for small parts and boxes, a minivan for several boxes, and a pickup truck for bulky items like bumpers, wheels and exhaust parts. No single piece over 75 lbs.'],
    ],
    faqs: [
      ['Can you pick up from a parts store and bring it to my shop?', 'Yes. Put the store as the pickup and your shop as the drop-off. With Rush, a driver goes right away.'],
      ['Do you offer business accounts?', 'Yes. Shops that book often can set up a business account and add their team. Contact us and we\'ll get you set up.'],
    ],
  },
  {
    slug: 'business-delivery-columbia-sc',
    nav: 'Business deliveries',
    title: 'Local Business Courier Service in Columbia, SC',
    description: 'Courier service for Columbia businesses: print shops, florists, retailers, online sellers, contractors and offices. Same-day and rush delivery with live tracking and proof.',
    h1: 'A courier for Columbia\'s local businesses',
    intro: 'You don\'t need a delivery driver on payroll to offer same-day delivery. Book us when you need us, and your customer gets a tracking link and a photo when it arrives.',
    sections: [
      ['Who we deliver for', 'Print and sign shops, florists, bakeries and gift shops, retailers and online sellers, contractors and supply houses, real estate and other offices. If it fits in a car, minivan or pickup truck, we can probably take it.'],
      ['Easy for you and your customers', 'Book online in minutes with an instant price, save quotes, and add coworkers to your company account. Our free shipping form prints a barcode label on regular paper, so you don\'t need a label printer.'],
    ],
    faqs: [
      ['Can I add my coworkers to our account?', 'Yes. Everyone on your company account can book and see the company\'s deliveries.'],
      ['Can you invoice us monthly?', 'Approved business accounts can be invoiced instead of paying by card for each order. Contact us to set it up.'],
    ],
  },
];

const ALL = [...AREAS, ...SERVICES];
module.exports = { AREAS, SERVICES, ALL };
