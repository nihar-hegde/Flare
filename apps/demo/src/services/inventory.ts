import { breadcrumb, withSpan } from "../lib/telemetry.js";

export interface InventoryItem {
  sku: string;
  name: string;
  available: number;
  warehouse: string;
}

const INVENTORY: Record<string, InventoryItem> = {
  pro_monthly: {
    sku: "pro_monthly",
    name: "Pro subscription",
    available: 999,
    warehouse: "digital",
  },
  team_seats_10: {
    sku: "team_seats_10",
    name: "10 team seats",
    available: 42,
    warehouse: "digital",
  },
};

export class StaleInventoryCacheError extends Error {
  constructor(sku: string) {
    super(`Inventory cache returned stale quantity for sku ${sku}`);
    this.name = "StaleInventoryCacheError";
  }
}

export async function reserveInventory(
  sku: string,
  quantity: number,
  scenario: string,
): Promise<InventoryItem> {
  breadcrumb("inventory", "Reserving inventory", { sku, quantity, scenario });

  return withSpan(
    "inventory.reserve",
    "cache",
    { sku, quantity, scenario },
    async () => {
      await sleep(16);

      if (scenario === "stale-inventory") {
        throw new StaleInventoryCacheError(sku);
      }

      const item = INVENTORY[sku];
      if (!item || item.available < quantity) {
        throw new Error(`Insufficient inventory for sku ${sku}`);
      }

      return { ...item, available: item.available - quantity };
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
