# Choice Delivery SC - Standalone Website

This is a complete standalone website for Choice Delivery SC that can be uploaded to any web hosting provider like Hostinger.

## Files Included

- `index.html` - Main landing page with all features
- `privacy.html` - Privacy policy page
- `README.md` - This file with instructions

## Features

### Landing Page (index.html)
- **Responsive Design** - Works on desktop, tablet, and mobile
- **Hero Section** - Eye-catching header with call-to-action buttons
- **Services Overview** - Same day delivery, standard delivery, business contracts
- **Business Contract Plans** - All 4 plans with pricing and features
- **Service Area Map** - 200-mile radius coverage details
- **Quick Quote Calculator** - Basic quote estimation tool
- **Contact Form** - Direct contact submission
- **App Integration** - Links to launch your delivery app
- **SEO Optimized** - Meta tags, descriptions, and structured data

### Business Revenue Features
- **Business Contract Signup** - Interactive plan selection
- **Lead Generation** - Multiple contract entry points
- **Professional Design** - Builds trust with business clients
- **Clear Pricing** - Transparent monthly rates ($200-500)

## Upload Instructions for Hostinger

1. **Log into Hostinger Control Panel**
2. **Go to File Manager** or use FTP
3. **Navigate to public_html folder**
4. **Upload all files:**
   - `index.html`
   - `privacy.html`
5. **Set index.html as default page** (usually automatic)

## Customization

### Update Contact Information
Edit these sections in `index.html`:
- Phone numbers: Search for `(803) 949-7034`
- Email addresses: Search for `info@choicedeliverysc.com`
- Service area: Update city names and coverage areas

### Modify Business Plans
Find the business contract section and update:
- Plan names and pricing
- Features and included deliveries
- Contract request functionality

### Brand Colors
The website uses your brand colors:
- **Teal**: `#0f766e` (primary)
- **Mint**: `#5eead4` (accent)

### App Integration
The website is configured to link to your custom domain:
```javascript
onclick="window.open('https://app.choicedeliverysc.com', '_blank')"
```

**Important**: After you deploy your Replit app with a custom domain:
1. Update this URL to match your actual custom domain
2. If you choose a different subdomain, replace `app.choicedeliverysc.com` with your chosen URL

## Features That Connect to Your App

### Business Contract Requests
The contract request buttons call `requestBusinessContract()` function. To connect to your actual backend:

1. Update the function in the JavaScript section
2. Replace the alert with an actual API call to your `/api/contracts/request` endpoint

### Contact Form
The contact form submits to JavaScript. To enable real submissions:

1. Create a contact form handler on your server
2. Update the form action and submission logic

### Quote Calculator
Currently shows estimated pricing. To connect to real quotes:

1. Replace `calculateQuote()` with API call to your pricing endpoint
2. Add real address validation and distance calculation

## Performance Features

- **Fast Loading** - Uses CDN for Tailwind CSS
- **Mobile Optimized** - Responsive design for all devices
- **SEO Ready** - Proper meta tags and structured data
- **Professional Design** - Builds business credibility

## Business Benefits

This standalone website provides:

1. **Professional Online Presence** - Replaces WordPress site
2. **Lead Generation** - Multiple business contract entry points
3. **Customer Acquisition** - Clear pricing and service information
4. **Brand Consistency** - Matches your app design
5. **Revenue Growth** - Prominent business plan promotion

The website is designed to drive your $200-500/month business contracts while also serving individual delivery customers.