import { TagColor } from "@mirohq/websdk-types";
import * as vscode from "vscode";
import { CardData, allColors } from "../EventTypes";
import { HandlerContext } from "../extension";
import { MiroServer } from "../server";

export function notEmpty<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export const makeTagCardHandler = (
  context: HandlerContext,
  miroServer: MiroServer,
) => {
  return async function () {
    await context.waitForConnections();

    const selectedCards = await context.cardStorage.getConnectedBoards().reduce(
      async (p, boardId) => {
        const selected: CardData[] = await p;
        const selectedCards = await miroServer.query(boardId, "selected");
        return selected.concat(selectedCards).filter(notEmpty);
      },
      Promise.resolve([] as CardData[]),
    );

    if (selectedCards.length > 0) {
      const links = selectedCards.map((c) => c.miroLink).filter(notEmpty);
      const boards = selectedCards.reduce((acc, card) => {
        return acc.includes(card.boardId) ? acc : acc.concat(card.boardId);
      }, [] as string[]);
      if (boards.length > 1) {
        vscode.window.showInformationMessage(
          "Please select cards from the same board to tag.",
        );
        return;
      }
      const boardId = boards[0];

      type TagSelection = vscode.QuickPickItem & {
        id: string;
      };
      const newCard: TagSelection = {
        label: "New Tag",
        id: "NEW_TAG",
      };
      const quickPicks: TagSelection[] = [newCard];
      const tags = await miroServer.query(boardId, "tags");
      quickPicks.push(
        ...tags.map((tag) => ({
          label: tag.title,
          description: tag.color,
          id: tag.id,
        })),
      );

      const tag = await vscode.window.showQuickPick(quickPicks, {
        title: `Tag ${selectedCards[0].title}${
          selectedCards.length > 1 ? ` and ${selectedCards.length} others` : ""
        }`,
      });

      if (tag) {
        if (tag.id === "NEW_TAG") {
          const title = await vscode.window.showInputBox({
            title: "New Tag Name",
          });
          if (!title) {
            return;
          }
          const color = await vscode.window.showQuickPick(allColors, {
            title: "Tag Color",
          });
          if (color) {
            miroServer.query(boardId, "tagCards", {
              miroLink: links,
              tag: {
                title,
                color: color as TagColor,
              },
            });
          }
        } else {
          miroServer.query(boardId, "tagCards", {
            miroLink: links,
            tag: tag.id,
          });
        }
      }
    } else {
      vscode.window.showInformationMessage(
        "Please select at least 1 card to tag.",
      );
    }
  };
};
