import type { Item } from "@mirohq/websdk-types/stable/api/client";
import type { AppCard } from "@mirohq/websdk-types/stable/features/widgets/appCard";

export const isAppCard = (item: Item): item is AppCard =>
  item.type === "app_card";
