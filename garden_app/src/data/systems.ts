import type { PlantingSystem } from '../domain/systems';

export const THREE_SISTERS: PlantingSystem = {
  id: 'three-sisters',
  name: 'Three Sisters',
  summary:
    'An Indigenous North American intercropping system of corn, climbing beans and squash (here: pumpkin) grown together on low mounds, each doing a job for the others.',
  culturalNote:
    'Developed and practised by Indigenous peoples of North America, including the Haudenosaunee (Iroquois). We present it as a planting method with respect for its origins.',
  members: [
    {
      role: 'support',
      roleLabel: 'Corn (the support)',
      plantId: 'sweet-corn',
      functions: ['Provides tall stalks for the beans to climb.'],
      perUnit: '5–7 corn seeds per mound',
    },
    {
      role: 'climber',
      roleLabel: 'Climbing beans (the climber)',
      plantId: 'bean-climbing',
      functions: [
        'Climbs the corn instead of needing a trellis.',
        'A legume: hosts nitrogen-fixing bacteria, adding nitrogen that mostly benefits later crops as roots and residue break down.',
      ],
      after: { role: 'support', days: [14, 21], trigger: 'when the corn is about 15 cm tall' },
      perUnit: '4–5 bean seeds per mound, around the young corn',
    },
    {
      role: 'groundcover',
      roleLabel: 'Pumpkin (the ground cover)',
      plantId: 'pumpkin',
      functions: ['Sprawls across the soil, shading out weeds and helping keep moisture in.'],
      after: { role: 'support', days: [14, 21], trigger: 'when the corn is about 15 cm tall' },
      perUnit: '4–5 pumpkin seeds in every seventh mound (or between mounds)',
    },
  ],
  layout: [
    'Make low mounds about 90–120 cm apart within and between rows.',
    'Sow 5–7 corn seeds per mound, about 2.5–4 cm deep.',
    'When the corn is roughly 15 cm tall, sow 4–5 climbing bean seeds around each mound.',
    'At the same stage, sow pumpkin seeds in some mounds (traditionally every seventh) or between mounds.',
  ],
  cautions: [
    'Beans sown at the same time as the corn can smother it before the stalks are strong enough — wait until the corn is established.',
    'Corn is hungry: interplanting without extra feeding may reduce yields (Cornell). Feed the corn as it grows.',
    'All three are frost-tender warm-season crops — the whole system needs your warm-season window.',
    'It needs space: one mound is roughly a square metre. Small beds may only fit a mini version.',
  ],
  sourceIds: ['cornell-three-sisters'],
};

export const PLANTING_SYSTEMS: PlantingSystem[] = [THREE_SISTERS];
