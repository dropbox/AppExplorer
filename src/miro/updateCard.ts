import type { AppCard } from "@mirohq/websdk-types/stable/features/widgets/appCard";
import type { CardField } from "@mirohq/websdk-types/stable/features/widgets/card";
import invariant from "tiny-invariant";
import type { CardData } from "../EventTypes";
import { MetaData } from "../miro";

export async function updateCard(
  card: AppCard,
  data: Partial<CardData>,
): Promise<AppCard> {
  let metaData: MetaData;
  invariant(data.path, "missing data.path in updateCard");
  if (data.type === "symbol") {
    metaData = {
      path: data.path,
      symbol: data.symbol ?? null,
      codeLink: data.codeLink ?? null,
    };
  } else {
    throw new Error(`Invalid card type: ${data.type}`);
  }

  await card.setMetadata("app-explorer", metaData);
  if (metaData.codeLink) {
    card.linkedTo = metaData.codeLink ?? "";
  }

  card.title = data.title ?? "";
  const fields: CardField[] = [
    {
      value: data.path,
      tooltip: data.path,
    },
  ];
  if (metaData.symbol) {
    fields.push({
      value: metaData.symbol,
      tooltip: `Symbol ${metaData.symbol}`,
    });
  }
  card.fields = fields;
  await card.sync();

  return card;
}
