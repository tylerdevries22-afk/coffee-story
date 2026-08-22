// Coffee Story menu for the screens: the pure model from ./catalog-data with
// each item's photography zipped back on. Everything except the images lives
// in catalog-data.ts so tests (and the tenants/coffee-story sync test) can
// reach the menu without asset imports.

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

import { CATALOG_ITEMS, type CatalogItemData, type MenuCategoryId } from './catalog-data';

export { MENU_CATEGORY_META } from './catalog-data';
export type { MenuCategoryId } from './catalog-data';

export type Service = CatalogItemData & {
  image: number;
  category: MenuCategoryId;
};

const ITEM_IMAGES: Readonly<Record<string, number>> = {
  espresso: espressoImg,
  americano: americanoImg,
  latte: latteImg,
  cappuccino: cappuccinoImg,
  'flat-white': flatWhiteImg,
  cortado: cortadoImg,
  macchiato: macchiatoImg,
  mocha: mochaImg,
  'cold-brew': coldBrewImg,
  frappe: frappeImg,
  'tiramisu-latte': tiramisuImg,
  'spanish-latte': spanishLatteImg,
  'pistachio-latte': pistachioImg,
  'ube-latte': ubeLatteImg,
  'honey-lavender-latte': honeyLavenderImg,
  'honey-rose-latte': honeyRoseImg,
  'brown-sugar-shaken-espresso': brownSugarImg,
  'biscoff-latte': biscoffImg,
  'spanish-oat-shaken': spanishOatImg,
  'libyan-nescafe': nescafeImg,
  'turkish-coffee': turkishImg,
  'loose-leaf-tea': looseLeafImg,
  'chai-latte': chaiImg,
  'london-fog': londonFogImg,
  'matcha-latte': matchaImg,
  'strawberry-matcha': strawberryMatchaImg,
  'ube-matcha': ubeMatchaImg,
  'orange-blossom-matcha': orangeBlossomImg,
  'honey-lavender-matcha': honeyLavenderMatchaImg,
  'spanish-matcha': spanishMatchaImg,
  'adeni-chai': adeniImg,
  'boba-milk-tea': bobaMilkTeaImg,
  'boba-brown-sugar': bobaBrownSugarImg,
  'boba-ube': bobaUbeImg,
  'boba-strawberry': bobaStrawberryImg,
  'boba-thai-tea': bobaThaiImg,
  'boba-rooh-afza': bobaRoohAfzaImg,
  'ade-strawberry': adeStrawberryImg,
  'ade-mango': adeMangoImg,
  'ade-sunset': adeSunsetImg,
  'ade-passion-fruit': adePassionImg,
  'midnight-lychee': midnightLycheeImg,
  'smoothie-strawberry-banana': smoothieStrawBananaImg,
  'smoothie-mango-banana': smoothieMangoBananaImg,
  'smoothie-strawberry-mango': smoothieStrawMangoImg,
  'smoothie-green-machine': smoothieGreenImg,
  'smoothie-banana-date': smoothieBananaDateImg,
  'sandwich-teriyaki': sandwichTeriyakiImg,
  'wrap-chicken-caesar': wrapCaesarImg,
  'panini-mozzarella': paniniImg,
  'sandwich-veggie': veggieImg,
  'avocado-toast': avocadoToastImg,
  'grilled-cheese': grilledCheeseImg,
  'toasted-bagel': bagelImg,
  'strawberry-nutella-croissant': nutellaCroissantImg,
  'croissant-cheese-honey': cheeseHoneyImg,
  'honeycomb-cheese-bread': honeycombImg,
  'honeycomb-condensed': condensedImg,
  'honeycomb-bites': bitesImg,
  'milk-cake': milkCakeImg,
  'mochi-donut': mochiImg,
};

function withImage(item: CatalogItemData): Service {
  const image = ITEM_IMAGES[item.id];
  if (image === undefined) {
    // A data item without a photo is a build mistake, not a runtime state.
    throw new Error(`Menu item "${item.id}" has no image in catalog.ts.`);
  }
  return { ...item, image };
}

export const SERVICES: readonly Service[] = CATALOG_ITEMS.map(withImage);

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
