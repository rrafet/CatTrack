/* Tailwind Play CDN theme. Separate file so the CSP can disallow inline scripts. */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        paper:   '#FAF8F4',   // warm off-white background
        card:    '#FFFFFF',
        ink:     '#2B2926',   // soft charcoal
        'ink-2': '#6E6A61',   // secondary text
        'ink-3': '#9B968B',   // tertiary / hints
        line:    '#E7E2D8',   // 1px borders
        'line-2':'#D9D3C7',
        navy:    '#184691',   // primary accent (from the logo)
        'navy-2': '#12317A',
        clay:    '#B0583A',   // warm warning tone (wanted badge, errors)
        'clay-2': '#8F4631',
        sage:    '#6F7D62',   // positive accents
        'sage-bg':'#EFF1EA',
        'clay-bg':'#F6ECE7',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
    },
  },
};
