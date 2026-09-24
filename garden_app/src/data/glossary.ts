/** Short, plain-language explanations shown as contextual help. */
export interface GlossaryTerm {
  id: string;
  term: string;
  short: string;
  more?: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  { id: 'direct-sow', term: 'Direct sow', short: 'Sowing seed straight into the garden bed where the plant will grow.', more: 'Best for crops that dislike being moved, such as carrots, radishes, beans and coriander.' },
  { id: 'transplant', term: 'Transplant', short: 'Moving a seedling from a tray or pot into its final spot.', more: 'Water seedlings before and after, and transplant in the cool of the day.' },
  { id: 'thin-seedlings', term: 'Thin seedlings', short: 'Removing extra seedlings so the rest have room to grow.', more: 'Snip unwanted seedlings at soil level rather than pulling, to avoid disturbing neighbours.' },
  { id: 'succession-planting', term: 'Succession planting', short: 'Sowing small batches every few weeks instead of all at once.', more: 'Gives a steady harvest instead of a glut followed by nothing.' },
  { id: 'hardening-off', term: 'Hardening off', short: 'Gradually getting indoor-raised seedlings used to outdoor sun and wind.', more: 'Put them outside for a little longer each day over about a week before transplanting.' },
  { id: 'side-dressing', term: 'Side-dressing', short: 'Adding fertiliser or compost along the side of growing plants.', more: 'Feeds hungry crops mid-season without disturbing roots.' },
  { id: 'bolting', term: 'Bolting', short: 'When a plant suddenly sends up a flower stalk and runs to seed.', more: 'Often triggered by heat or long days. Leaves usually turn bitter afterwards — lettuce, coriander, rocket and spinach are prone to it.' },
  { id: 'determinate', term: 'Determinate', short: 'Bush-type tomatoes that grow to a set size and crop over a shorter period.', more: 'Good for pots and for preserving a big batch at once.' },
  { id: 'indeterminate', term: 'Indeterminate', short: 'Vine-type tomatoes that keep growing and cropping until the weather stops them.', more: 'Need tall stakes or a trellis.' },
  { id: 'nitrogen-fixation', term: 'Nitrogen fixation', short: 'Legumes (beans, peas) host soil bacteria that turn air nitrogen into a form plants can use.', more: 'Most of the benefit reaches later crops when the legume roots and leaves break down.' },
  { id: 'green-manure', term: 'Green manure', short: 'A crop grown to be cut and dug in (or laid on the surface) to feed the soil.', more: 'Usually cut just before flowering, when it is most nutrient-rich.' },
  { id: 'mulch', term: 'Mulch', short: 'A layer of material (straw, sugarcane, bark, compost) spread over the soil.', more: 'Keeps soil moist and cool, suppresses weeds and feeds soil life as it breaks down. Keep it clear of stems.' },
  { id: 'companion-planting', term: 'Companion planting', short: 'Growing plants together so they help each other.', more: 'Some benefits are practical and well understood (shade, support, pollinators); others are traditional with limited evidence. The app labels which is which.' },
  { id: 'crop-rotation', term: 'Crop rotation', short: 'Not growing related crops in the same spot year after year.', more: 'Helps prevent a build-up of soil-borne pests and diseases.' },
  { id: 'germination', term: 'Germination', short: 'When a seed starts to sprout.', more: 'Needs moisture and the right soil temperature; many warm-season seeds rot in cold soil.' },
  { id: 'frost-tender', term: 'Frost-tender', short: 'Damaged or killed by frost.', more: 'Tomatoes, basil, beans, pumpkins and most warm-season crops are frost-tender.' },
  { id: 'cut-and-come-again', term: 'Cut-and-come-again', short: 'Picking some leaves at a time so the plant keeps producing.', more: 'Lettuce, silverbeet, kale and many herbs work this way.' },
  { id: 'hilling', term: 'Hilling', short: 'Mounding soil or compost around the stems of a plant as it grows.', more: 'Used for potatoes to keep tubers covered and give them room to form.' },
  { id: 'microclimate', term: 'Microclimate', short: 'Local conditions that differ from your general climate.', more: 'A sheltered north-facing wall, a frost hollow or a shady courtyard can all change what grows well. You can override your climate zone to reflect this.' },
  { id: 'soil-ph', term: 'Soil pH', short: 'How acidic or alkaline soil is (7 is neutral).', more: 'Most vegetables like about 6–7. Blueberries need much more acidic soil (about 4–5).' },
  { id: 'modelled-soil-temperature', term: 'Modelled soil temperature', short: 'An estimate from a weather model, not a thermometer in your soil.', more: 'Useful as a guide. Your own soil may be warmer or cooler depending on sun, mulch and moisture — a soil thermometer gives the real reading.' },
];
