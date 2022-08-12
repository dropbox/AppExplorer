import React from "react";
import Title from "./title";
import MissingImport from "./missing";

/**
 * At the moment, because this function isn't on the graph this note gets
 * attached to the AppCard for this module
 *
 * @AppExplorer https://miro.com/app/board/uXjVOk9T9PU=/?moveToWidget=3458764530344562209&cot=14
 */
function initialize() {}

/**
 * Example component
 *
 * @AppExplorer https://miro.com/app/board/uXjVOk9T9PU=/?moveToWidget=3458764530344562218&cot=14
 * @param props
 * @returns
 */
export default function HelloWorld(props: { name: string }) {
  React.useEffect(() => {
    initialize();
  }, []);
  return (
    <div>
      <Title>Hello {props.name}</Title>
      <MissingImport>What happens here?</MissingImport>
      <button>Increment</button>
    </div>
  );
}
export class Button extends React.Component {
  render() {
    return <button>test</button>;
  }
}
