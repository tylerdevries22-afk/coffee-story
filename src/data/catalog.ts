// Coffee Story menu. The Service type keeps its original shape; `minutes` is
// repurposed as drink size in ounces (12/16/20) — the order flow renders it as
// "oz" instead of "min". Prices in whole dollars, as before.
import adeniChai from '../../assets/menu/adeni-chai.webp';
import bobaMilkTea from '../../assets/menu/boba-milk-tea.webp';
import sunsetSparkler from '../../assets/menu/sunset-sparkler.webp';
import honeycombBread from '../../assets/menu/honeycomb-cheese-bread.webp';
import midnightLychee from '../../assets/menu/midnight-lychee.webp';
import milkCake from '../../assets/menu/milk-cake.webp';
import mochiDonut from '../../assets/menu/mochi-donut.webp';
import pistachioLatte from '../../assets/menu/pistachio-latte.webp';
import roohAfzaMatcha from '../../assets/menu/rooh-afza-matcha.webp';
import spanishLatte from '../../assets/menu/spanish-latte.webp';
import nutellaCroissant from '../../assets/menu/nutella-croissant.webp';
import turkishCoffee from '../../assets/menu/turkish-coffee.webp';

export type Service = {
  id: string;
  name: string;
  description: string;
  image: number;
  /**
   * Each size carries the slug an order is actually made against.
   */
  durations: readonly { slug: string; minutes: number; price: number }[];
};

export const SERVICES: readonly Service[] = [
  {
    id: 'spanish-latte',
    name: 'Spanish Latte',
    description: 'Espresso with sweetened condensed milk — silky and rich.',
    image: spanishLatte,
    durations: [
      { slug: 'spanish-latte-12', minutes: 12, price: 6 },
      { slug: 'spanish-latte-16', minutes: 16, price: 7 },
      { slug: 'spanish-latte-20', minutes: 20, price: 8 },
    ],
  },
  {
    id: 'pistachio-latte',
    name: 'Pistachio Latte',
    description: 'House pistachio cream folded into espresso and steamed milk.',
    image: pistachioLatte,
    durations: [
      { slug: 'pistachio-latte-12', minutes: 12, price: 6 },
      { slug: 'pistachio-latte-16', minutes: 16, price: 7 },
      { slug: 'pistachio-latte-20', minutes: 20, price: 8 },
    ],
  },
  {
    id: 'turkish-coffee',
    name: 'Turkish Coffee',
    description: 'Traditional, slow-brewed and unfiltered — a ritual in a cup.',
    image: turkishCoffee,
    durations: [
      { slug: 'turkish-coffee-single', minutes: 8, price: 5 },
      { slug: 'turkish-coffee-double', minutes: 12, price: 7 },
    ],
  },
  {
    id: 'adeni-chai',
    name: 'Adeni Chai',
    description: 'Yemeni spiced milk tea, simmered with cardamom and cloves.',
    image: adeniChai,
    durations: [
      { slug: 'adeni-chai-12', minutes: 12, price: 5 },
      { slug: 'adeni-chai-16', minutes: 16, price: 6 },
      { slug: 'adeni-chai-20', minutes: 20, price: 7 },
    ],
  },
  {
    id: 'rooh-afza-matcha',
    name: 'Rooh Afza Matcha',
    description: 'Floral Rooh Afza swirled into creamy ceremonial matcha.',
    image: roohAfzaMatcha,
    durations: [
      { slug: 'rooh-afza-matcha-12', minutes: 12, price: 6 },
      { slug: 'rooh-afza-matcha-16', minutes: 16, price: 7 },
      { slug: 'rooh-afza-matcha-20', minutes: 20, price: 8 },
    ],
  },
  {
    id: 'sunset-sparkler',
    name: 'Sunset Sparkler',
    description: 'A golden-hour sparkling ade — citrus over ice, Coffee Story style.',
    image: sunsetSparkler,
    durations: [
      { slug: 'sunset-sparkler-16', minutes: 16, price: 6 },
      { slug: 'sunset-sparkler-20', minutes: 20, price: 7 },
    ],
  },
  {
    id: 'midnight-lychee',
    name: 'Midnight Lychee Refresher',
    description: 'Sparkling lychee ade over ice — our late-night favorite.',
    image: midnightLychee,
    durations: [
      { slug: 'midnight-lychee-16', minutes: 16, price: 6 },
      { slug: 'midnight-lychee-20', minutes: 20, price: 7 },
    ],
  },
  {
    id: 'boba-milk-tea',
    name: 'Brown Sugar Boba Milk Tea',
    description: 'Brown-sugar boba pearls shaken with creamy milk tea.',
    image: bobaMilkTea,
    durations: [
      { slug: 'boba-milk-tea-16', minutes: 16, price: 6 },
      { slug: 'boba-milk-tea-20', minutes: 20, price: 7 },
    ],
  },
  {
    id: 'mochi-donut',
    name: 'Mochi Donut',
    description: 'Chewy, glazed, made fresh — pistachio, ube, or classic.',
    image: mochiDonut,
    durations: [
      { slug: 'mochi-donut-single', minutes: 1, price: 4 },
      { slug: 'mochi-donut-trio', minutes: 3, price: 10 },
    ],
  },
  {
    id: 'honeycomb-cheese-bread',
    name: 'Honeycomb Cheese Bread',
    description: 'Golden, pull-apart cheese bread drizzled with honey.',
    image: honeycombBread,
    durations: [
      { slug: 'honeycomb-cheese-bread', minutes: 1, price: 7 },
    ],
  },
  {
    id: 'milk-cake',
    name: 'Milk Cake',
    description: 'Condensed-milk soaked cake — pistachio, lotus, or saffron.',
    image: milkCake,
    durations: [
      { slug: 'milk-cake-slice', minutes: 1, price: 7 },
    ],
  },
  {
    id: 'nutella-croissant',
    name: 'Stuffed Nutella Croissant',
    description: 'Flaky croissant stuffed with Nutella — a late-night favorite.',
    image: nutellaCroissant,
    durations: [
      { slug: 'nutella-croissant', minutes: 1, price: 6 },
    ],
  },
] as const;

export const AVAILABLE_DATES = ['Today', 'Tomorrow', 'Sat 1', 'Sun 2', 'Mon 3'] as const;
export const AVAILABLE_TIMES = ['8:30 AM', '10:00 AM', '12:30 PM', '3:00 PM', '6:30 PM'] as const;

// Menu extras (drink customizations); the data lives in ./add-ons (pure
// module) so the contract stays unit-testable.
export { DEMO_ADD_ONS } from './add-ons';

export const REDEMPTIONS = [
  { id: 'r1', name: '$5 drink credit', points: 500 },
  { id: 'r2', name: 'Free mochi donut', points: 800 },
  { id: 'r3', name: '$15 drink credit', points: 1500 },
  { id: 'r4', name: 'Free signature latte', points: 2000 },
] as const;
