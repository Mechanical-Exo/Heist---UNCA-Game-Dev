// Core types shared across the game
export type ItemCategory = "kitchen" | "jewelry" | "technology" | "clothing" | "art";

export interface ItemTemplate {
  name: string;
  category: ItemCategory;
  value: number;
  weight: number;
  color: string;
  symbol: string;
}

export interface WorldItem {
  id: number;
  template: ItemTemplate;
  col: number;
  row: number;
  collected: boolean;
}

export const CATEGORY_COLOR: Record<ItemCategory, string> = {
  kitchen:    "#ff8c42",
  jewelry:    "#ffd700",
  technology: "#00e5ff",
  clothing:   "#ce93d8",
  art:        "#a5d6a7",
};
