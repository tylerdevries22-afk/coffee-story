import type { CatalogSize } from '@platform/domain';
// Coffee Story menu — the complete menu from coffeestoryco.com, organized by
// category. The MenuItem type keeps its original shape; `minutes` is repurposed
// as drink size in ounces (12/16/20) — the order flow renders it as "oz"
// instead of "min". Prices in whole dollars, "from" the smallest size.

import adeniImg from '../../assets/menu/adeni-chai.webp';
import adeMangoImg from '../../assets/menu/ade-mango.webp';
import adePassionImg from '../../assets/menu/ade-passion-fruit.webp';
import adeStrawberryImg from '../../assets/menu/ade-strawberry.webp';
import adeSunsetImg from '../../assets/menu/ade-sunset.webp';
import americanoImg from '../../assets/menu/americano.webp';
import avocadoToastImg from '../../assets/menu/avocado-toast.webp';
import bagelImg from '../../assets/menu/toasted-bagel.webp';
import biscoffImg from '../../assets/menu/biscoff-latte.webp';
import bitesImg from '../../assets/menu/honeycomb-bites.webp';

import bobaBrownSugarImg from '../../assets/menu/boba-brown-sugar.webp';
import bobaMilkTeaImg from '../../assets/menu/boba-milk-tea.webp';
import bobaRoohAfzaImg from '../../assets/menu/boba-rooh-afza.webp';
import bobaStrawberryImg from '../../assets/menu/boba-strawberry.webp';
import bobaThaiImg from '../../assets/menu/boba-thai-tea.webp';
import bobaUbeImg from '../../assets/menu/boba-ube.webp';
import brownSugarImg from '../../assets/menu/brown-sugar-shaken-espresso.webp';
import cappuccinoImg from '../../assets/menu/cappuccino.webp';
import chaiImg from '../../assets/menu/chai-latte.webp';
import cheeseHoneyImg from '../../assets/menu/croissant-cheese-honey.webp';
import coldBrewImg from '../../assets/menu/cold-brew.webp';
import condensedImg from '../../assets/menu/honeycomb-condensed.webp';
import cortadoImg from '../../assets/menu/cortado.webp';
import espressoImg from '../../assets/menu/espresso.webp';
import flatWhiteImg from '../../assets/menu/flat-white.webp';
import frappeImg from '../../assets/menu/frappe.webp';
import grilledCheeseImg from '../../assets/menu/grilled-cheese.webp';
import honeycombImg from '../../assets/menu/honeycomb-cheese-bread.webp';
import honeyLavenderImg from '../../assets/menu/honey-lavender-latte.webp';
import honeyLavenderMatchaImg from '../../assets/menu/honey-lavender-matcha.webp';
import honeyRoseImg from '../../assets/menu/honey-rose-latte.webp';
import latteImg from '../../assets/menu/latte.webp';
import londonFogImg from '../../assets/menu/london-fog.webp';
import looseLeafImg from '../../assets/menu/loose-leaf-tea.webp';
import macchiatoImg from '../../assets/menu/macchiato.webp';
import matchaImg from '../../assets/menu/matcha-latte.webp';
import midnightLycheeImg from '../../assets/menu/midnight-lychee.webp';
import milkCakeImg from '../../assets/menu/milk-cake.webp';
import mochaImg from '../../assets/menu/mocha.webp';
import mochiImg from '../../assets/menu/mochi-donut.webp';
import nescafeImg from '../../assets/menu/libyan-nescafe.webp';
import nutellaCroissantImg from '../../assets/menu/strawberry-nutella-croissant.webp';
import orangeBlossomImg from '../../assets/menu/orange-blossom-matcha.webp';
import paniniImg from '../../assets/menu/panini-mozzarella.webp';
import pistachioImg from '../../assets/menu/pistachio-latte.webp';
import sandwichTeriyakiImg from '../../assets/menu/sandwich-teriyaki.webp';
import smoothieBananaDateImg from '../../assets/menu/smoothie-banana-date.webp';
import smoothieGreenImg from '../../assets/menu/smoothie-green-machine.webp';
import smoothieMangoBananaImg from '../../assets/menu/smoothie-mango-banana.webp';
import smoothieStrawBananaImg from '../../assets/menu/smoothie-strawberry-banana.webp';
import smoothieStrawMangoImg from '../../assets/menu/smoothie-strawberry-mango.webp';
import spanishLatteImg from '../../assets/menu/spanish-latte.webp';
import spanishMatchaImg from '../../assets/menu/spanish-matcha.webp';
import spanishOatImg from '../../assets/menu/spanish-oat-shaken.webp';
import strawberryMatchaImg from '../../assets/menu/strawberry-matcha.webp';
import tiramisuImg from '../../assets/menu/tiramisu-latte.webp';
import turkishImg from '../../assets/menu/turkish-coffee.webp';
import ubeLatteImg from '../../assets/menu/ube-latte.webp';
import ubeMatchaImg from '../../assets/menu/ube-matcha.webp';
import veggieImg from '../../assets/menu/sandwich-veggie.webp';
import wrapCaesarImg from '../../assets/menu/wrap-chicken-caesar.webp';


export type MenuCategoryId =
  | 'coffee'
  | 'signature'
  | 'tea-matcha'
  | 'boba'
  | 'ades-smoothies'
  | 'sandwiches'
  | 'sweets';

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  image: number;
  category: MenuCategoryId;
  /**
   * Each size carries the slug an order is actually made against.
   */
  sizes: readonly CatalogSize[];
};

export const MENU_CATEGORY_META: readonly { id: MenuCategoryId; title: string; tagline: string }[] = [
  { id: 'coffee', title: 'Coffee & Espresso', tagline: 'Corvus Coffee, pulled with care' },
  { id: 'signature', title: 'Signature Lattes', tagline: 'The drinks that made us famous' },
  { id: 'tea-matcha', title: 'Tea & Matcha', tagline: 'Whisked, brewed, and spiced' },
  { id: 'boba', title: 'Boba', tagline: 'Bubble tea with brown sugar boba' },
  { id: 'ades-smoothies', title: 'Sparkling Ades & Smoothies', tagline: 'Bright, cold, and refreshing' },
  { id: 'sandwiches', title: 'Sandwiches', tagline: 'Halal-friendly, made to order' },
  { id: 'sweets', title: 'Sweets & Desserts', tagline: 'Late-night cravings, sorted' },
] as const;

/** Standard three-size drink ladder around a 16 oz base price. */
function drinkSizes(id: string, base: number) {
  return [
    { slug: `${id}-12`, ounces: 12, priceCents: (base - 1) * 100 },
    { slug: `${id}-16`, ounces: 16, priceCents: base * 100 },
    { slug: `${id}-20`, ounces: 20, priceCents: (base + 1) * 100 },
  ] as const;
}

/** Food and single-serve items. */
function eachSize(id: string, dollars: number) {
  return [{ slug: id, priceCents: dollars * 100 }] as const;
}

export const MENU_ITEMS: readonly MenuItem[] = [
  // ---- Coffee & Espresso ----
  { id: 'espresso', name: 'Espresso', description: 'Classic espresso shot.', image: espressoImg, category: 'coffee', sizes: eachSize('espresso', 4) },
  { id: 'americano', name: 'Americano', description: 'Espresso with hot water.', image: americanoImg, category: 'coffee', sizes: drinkSizes('americano', 4) },
  { id: 'latte', name: 'Latte', description: 'Espresso with steamed milk and foam.', image: latteImg, category: 'coffee', sizes: drinkSizes('latte', 5) },
  { id: 'cappuccino', name: 'Cappuccino', description: 'Equal parts espresso, steamed milk, milk foam.', image: cappuccinoImg, category: 'coffee', sizes: drinkSizes('cappuccino', 5) },
  { id: 'flat-white', name: 'Flat White', description: 'Espresso topped with micro-foamed milk.', image: flatWhiteImg, category: 'coffee', sizes: drinkSizes('flat-white', 5) },
  { id: 'cortado', name: 'Cortado', description: 'Equal parts espresso and warm milk, no foam.', image: cortadoImg, category: 'coffee', sizes: eachSize('cortado', 5) },
  { id: 'macchiato', name: 'Macchiato', description: "Espresso 'stained' with milk foam.", image: macchiatoImg, category: 'coffee', sizes: eachSize('macchiato', 4) },
  { id: 'mocha', name: 'Mocha', description: 'Espresso, steamed milk and chocolate.', image: mochaImg, category: 'coffee', sizes: drinkSizes('mocha', 6) },
  { id: 'cold-brew', name: 'Cold Brew', description: 'Our Corvus Coffee brewed with cold water over many hours.', image: coldBrewImg, category: 'coffee', sizes: drinkSizes('cold-brew', 5) },
  { id: 'frappe', name: 'Frappes', description: 'Biscoff, caramel, strawberry, or Nutella.', image: frappeImg, category: 'coffee', sizes: drinkSizes('frappe', 7) },

  // ---- Signature Lattes ----
  { id: 'tiramisu-latte', name: 'Tiramisu Latte', description: 'Espresso layered with mascarpone cream, dusted with cocoa.', image: tiramisuImg, category: 'signature', sizes: drinkSizes('tiramisu-latte', 7) },
  { id: 'spanish-latte', name: 'Spanish Latte', description: 'Espresso with sweetened condensed milk — silky and rich.', image: spanishLatteImg, category: 'signature', sizes: drinkSizes('spanish-latte', 6) },
  { id: 'pistachio-latte', name: 'Pistachio Latte', description: 'House pistachio cream folded into espresso and steamed milk.', image: pistachioImg, category: 'signature', sizes: drinkSizes('pistachio-latte', 7) },
  { id: 'ube-latte', name: 'Ube Latte', description: 'Purple yam sweetness swirled into creamy espresso.', image: ubeLatteImg, category: 'signature', sizes: drinkSizes('ube-latte', 7) },
  { id: 'honey-lavender-latte', name: 'Honey Lavender Latte', description: 'Floral lavender and golden honey over espresso.', image: honeyLavenderImg, category: 'signature', sizes: drinkSizes('honey-lavender-latte', 6) },
  { id: 'honey-rose-latte', name: 'Honey Rose Latte', description: 'Soft rose notes sweetened with honey.', image: honeyRoseImg, category: 'signature', sizes: drinkSizes('honey-rose-latte', 6) },
  { id: 'brown-sugar-shaken-espresso', name: 'Brown Sugar Shaken Espresso', description: 'Shaken, frothy espresso with caramelized brown sugar.', image: brownSugarImg, category: 'signature', sizes: drinkSizes('brown-sugar-shaken-espresso', 6) },
  { id: 'biscoff-latte', name: 'Biscoff Latte', description: 'Cookie butter swirled into espresso and milk.', image: biscoffImg, category: 'signature', sizes: drinkSizes('biscoff-latte', 7) },
  { id: 'spanish-oat-shaken', name: 'Spanish Oat Milk Shaken Espresso', description: 'Creamy oat milk shaken with sweetened espresso.', image: spanishOatImg, category: 'signature', sizes: drinkSizes('spanish-oat-shaken', 6) },
  { id: 'libyan-nescafe', name: 'Libyan Nescafe', description: 'The beloved Libyan classic — light, frothy, comforting.', image: nescafeImg, category: 'signature', sizes: eachSize('libyan-nescafe', 5) },
  { id: 'turkish-coffee', name: 'Turkish Coffee', description: 'Traditional, slow-brewed and unfiltered — a ritual in a cup.', image: turkishImg, category: 'signature', sizes: [
    { slug: 'turkish-coffee-single', ounces: 8, priceCents: 500 },
    { slug: 'turkish-coffee-double', ounces: 12, priceCents: 700 },
  ] },

  // ---- Tea & Matcha ----
  { id: 'loose-leaf-tea', name: 'Loose Leaf Tea', description: 'Fresh brewed whole tea leaves.', image: looseLeafImg, category: 'tea-matcha', sizes: eachSize('loose-leaf-tea', 4) },
  { id: 'chai-latte', name: 'Chai Latte', description: 'Black tea blended with cinnamon and cardamom.', image: chaiImg, category: 'tea-matcha', sizes: drinkSizes('chai-latte', 5) },
  { id: 'london-fog', name: 'London Fog', description: 'Earl Grey tea with vanilla and steamed milk.', image: londonFogImg, category: 'tea-matcha', sizes: drinkSizes('london-fog', 5) },
  { id: 'matcha-latte', name: 'Matcha Latte', description: 'Finely ground green tea whisked with milk.', image: matchaImg, category: 'tea-matcha', sizes: drinkSizes('matcha-latte', 6) },
  { id: 'strawberry-matcha', name: 'Strawberry Matcha', description: 'Matcha latte layered with strawberry.', image: strawberryMatchaImg, category: 'tea-matcha', sizes: drinkSizes('strawberry-matcha', 6) },
  { id: 'ube-matcha', name: 'Ube Matcha', description: 'Matcha with purple yam (ube).', image: ubeMatchaImg, category: 'tea-matcha', sizes: drinkSizes('ube-matcha', 6) },
  { id: 'orange-blossom-matcha', name: 'Orange Blossom Matcha', description: 'Matcha infused with orange blossom notes.', image: orangeBlossomImg, category: 'tea-matcha', sizes: drinkSizes('orange-blossom-matcha', 6) },
  { id: 'honey-lavender-matcha', name: 'Honey Lavender Matcha', description: 'Matcha sweetened with honey and lavender.', image: honeyLavenderMatchaImg, category: 'tea-matcha', sizes: drinkSizes('honey-lavender-matcha', 6) },
  { id: 'spanish-matcha', name: 'Spanish Matcha', description: 'A creamy matcha made with condensed milk.', image: spanishMatchaImg, category: 'tea-matcha', sizes: drinkSizes('spanish-matcha', 6) },
  { id: 'adeni-chai', name: 'Adeni Chai', description: 'Traditional Yemeni chai brewed with black tea and warm spices.', image: adeniImg, category: 'tea-matcha', sizes: drinkSizes('adeni-chai', 5) },

  // ---- Boba ----
  { id: 'boba-milk-tea', name: 'Milk Tea Boba', description: 'Classic creamy milk tea with brown sugar boba.', image: bobaMilkTeaImg, category: 'boba', sizes: [
    { slug: 'boba-milk-tea-16', ounces: 16, priceCents: 600 },
    { slug: 'boba-milk-tea-20', ounces: 20, priceCents: 700 },
  ] },
  { id: 'boba-brown-sugar', name: 'Brown Sugar Boba', description: 'Tiger-stripe brown sugar syrup over fresh milk and boba.', image: bobaBrownSugarImg, category: 'boba', sizes: [
    { slug: 'boba-brown-sugar-16', ounces: 16, priceCents: 600 },
    { slug: 'boba-brown-sugar-20', ounces: 20, priceCents: 700 },
  ] },
  { id: 'boba-ube', name: 'Ube Boba', description: 'Purple yam milk tea with chewy boba pearls.', image: bobaUbeImg, category: 'boba', sizes: [
    { slug: 'boba-ube-16', ounces: 16, priceCents: 600 },
    { slug: 'boba-ube-20', ounces: 20, priceCents: 700 },
  ] },
  { id: 'boba-strawberry', name: 'Strawberry Boba', description: 'Pink strawberry milk tea with boba pearls.', image: bobaStrawberryImg, category: 'boba', sizes: [
    { slug: 'boba-strawberry-16', ounces: 16, priceCents: 600 },
    { slug: 'boba-strawberry-20', ounces: 20, priceCents: 700 },
  ] },
  { id: 'boba-thai-tea', name: 'Thai Tea Boba', description: 'Bright orange Thai tea over ice with boba.', image: bobaThaiImg, category: 'boba', sizes: [
    { slug: 'boba-thai-tea-16', ounces: 16, priceCents: 600 },
    { slug: 'boba-thai-tea-20', ounces: 20, priceCents: 700 },
  ] },
  { id: 'boba-rooh-afza', name: 'Rooh Afza Boba', description: 'Rose-kissed Rooh Afza milk drink with boba pearls.', image: bobaRoohAfzaImg, category: 'boba', sizes: [
    { slug: 'boba-rooh-afza-16', ounces: 16, priceCents: 600 },
    { slug: 'boba-rooh-afza-20', ounces: 20, priceCents: 700 },
  ] },

  // ---- Sparkling Ades & Smoothies ----
  { id: 'ade-strawberry', name: 'Strawberry Sparkling Ade', description: 'Ruby strawberry sparkling ade over ice. Add an energy shot.', image: adeStrawberryImg, category: 'ades-smoothies', sizes: drinkSizes('ade-strawberry', 6) },
  { id: 'ade-mango', name: 'Mango Sparkling Ade', description: 'Golden mango sparkling ade over ice.', image: adeMangoImg, category: 'ades-smoothies', sizes: drinkSizes('ade-mango', 6) },
  { id: 'ade-sunset', name: 'Sunset Sparkling Ade', description: 'Our golden-hour signature — citrus layers over ice.', image: adeSunsetImg, category: 'ades-smoothies', sizes: drinkSizes('ade-sunset', 6) },
  { id: 'ade-passion-fruit', name: 'Passion Fruit Sparkling Ade', description: 'Tropical passion fruit sparkle over ice.', image: adePassionImg, category: 'ades-smoothies', sizes: drinkSizes('ade-passion-fruit', 6) },
  { id: 'midnight-lychee', name: 'Midnight Lychee Ade', description: 'Sparkling lychee ade — our late-night favorite.', image: midnightLycheeImg, category: 'ades-smoothies', sizes: drinkSizes('midnight-lychee', 6) },
  { id: 'smoothie-strawberry-banana', name: 'Strawberry Banana Smoothie', description: 'Thick, creamy strawberry-banana blend.', image: smoothieStrawBananaImg, category: 'ades-smoothies', sizes: drinkSizes('smoothie-strawberry-banana', 7) },
  { id: 'smoothie-mango-banana', name: 'Mango Banana Smoothie', description: 'Golden mango blended smooth with banana.', image: smoothieMangoBananaImg, category: 'ades-smoothies', sizes: drinkSizes('smoothie-mango-banana', 7) },
  { id: 'smoothie-strawberry-mango', name: 'Strawberry Mango Smoothie', description: 'Pink and orange layers in one cup.', image: smoothieStrawMangoImg, category: 'ades-smoothies', sizes: drinkSizes('smoothie-strawberry-mango', 7) },
  { id: 'smoothie-green-machine', name: 'Green Machine Smoothie', description: 'Vibrant green and mango smoothie — fresh and bright.', image: smoothieGreenImg, category: 'ades-smoothies', sizes: drinkSizes('smoothie-green-machine', 7) },
  { id: 'smoothie-banana-date', name: 'Banana Date Smoothie', description: 'Creamy banana with sweet dates and honey.', image: smoothieBananaDateImg, category: 'ades-smoothies', sizes: drinkSizes('smoothie-banana-date', 7) },

  // ---- Sandwiches ----
  { id: 'sandwich-teriyaki', name: 'Teriyaki Chicken Sandwich', description: 'Teriyaki chicken, mozzarella, avocado, sun-dried tomato and pesto on white bread.', image: sandwichTeriyakiImg, category: 'sandwiches', sizes: eachSize('sandwich-teriyaki', 10) },
  { id: 'wrap-chicken-caesar', name: 'Chicken Caesar Wrap', description: 'Chicken, romaine, parmesan and Caesar dressing in a tortilla.', image: wrapCaesarImg, category: 'sandwiches', sizes: eachSize('wrap-chicken-caesar', 9) },
  { id: 'panini-mozzarella', name: 'Mozzarella Panini', description: 'Mozzarella, roasted red pepper, tomato, pesto and balsamic glaze.', image: paniniImg, category: 'sandwiches', sizes: eachSize('panini-mozzarella', 9) },
  { id: 'sandwich-veggie', name: 'Veggie Sandwich', description: 'Spring mix, avocado, tomato, mozzarella, pesto and balsamic on white bread.', image: veggieImg, category: 'sandwiches', sizes: eachSize('sandwich-veggie', 9) },
  { id: 'avocado-toast', name: 'Avocado Toast', description: 'Avocado, cherry tomato, pepper and balsamic glaze on toast.', image: avocadoToastImg, category: 'sandwiches', sizes: eachSize('avocado-toast', 8) },
  { id: 'grilled-cheese', name: 'Grilled Cheese', description: 'Mozzarella, cheddar and provolone on buttered toast.', image: grilledCheeseImg, category: 'sandwiches', sizes: eachSize('grilled-cheese', 7) },
  { id: 'toasted-bagel', name: 'Toasted Bagels', description: 'Plain or everything bagel with cream cheese.', image: bagelImg, category: 'sandwiches', sizes: eachSize('toasted-bagel', 4) },

  // ---- Sweets & Desserts ----
  { id: 'strawberry-nutella-croissant', name: 'Strawberry Nutella Croissant', description: 'Fresh baked croissant stuffed with Nutella, topped with strawberry and Nutella drizzle.', image: nutellaCroissantImg, category: 'sweets', sizes: eachSize('strawberry-nutella-croissant', 6) },
  { id: 'croissant-cheese-honey', name: 'Cheese & Honey Croissant', description: 'Croissant stuffed with cream cheese, topped with honey drizzle.', image: cheeseHoneyImg, category: 'sweets', sizes: eachSize('croissant-cheese-honey', 6) },
  { id: 'honeycomb-cheese-bread', name: 'Honeycomb Cheese Bread', description: 'Topped with Nutella, Biscoff, or white chocolate.', image: honeycombImg, category: 'sweets', sizes: eachSize('honeycomb-cheese-bread', 7) },
  { id: 'honeycomb-condensed', name: 'Condensed Milk Honeycomb', description: 'Honeycomb cheese bread soaked in condensed milk.', image: condensedImg, category: 'sweets', sizes: eachSize('honeycomb-condensed', 8) },
  { id: 'honeycomb-bites', name: 'Honeycomb Bites', description: 'Bite-size honeycomb cheese bread.', image: bitesImg, category: 'sweets', sizes: eachSize('honeycomb-bites', 5) },
  { id: 'milk-cake', name: 'Flavored Milk Cakes', description: 'Tres leches style cakes — pistachio, lotus, or saffron.', image: milkCakeImg, category: 'sweets', sizes: eachSize('milk-cake', 7) },
  { id: 'mochi-donut', name: 'Mochi Donut', description: 'Chewy, glazed, made fresh — pistachio, ube, or Nutella.', image: mochiImg, category: 'sweets', sizes: [
    { slug: 'mochi-donut-single', ounces: 1, priceCents: 400 },
    { slug: 'mochi-donut-trio', ounces: 3, priceCents: 1000 },
  ] },
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

