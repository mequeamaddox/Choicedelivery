// Builds landing/site.css from the Tailwind classes used in the landing pages:
//   npm run build:landing-css   (run after changing classes in landing/*.html)
module.exports = { content: [`${__dirname}/*.html`], theme: { extend: {} }, plugins: [] };
