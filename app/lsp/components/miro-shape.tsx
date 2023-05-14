import type { DropEvent } from '@mirohq/websdk-types';
import type { ShapeProps } from '@mirohq/websdk-types';
import classNames from 'classnames';
import React, { useId } from 'react'

const defaultStyles = {
  fillColor: "#F7F5F2",
  textAlign: 'center',
  textAlignVertical: 'middle',
  borderColor: '#000000',
  borderStyle: 'normal',
  borderOpacity: 1,
  color: "#007891",
  borderWidth: 1
}

type Meta = Record<string, string | number | boolean | object | undefined>


type Props = {
  shape?: ShapeProps['shape']
  content: string,
  width: number,
  height: number,
  style?: ShapeProps['style']
  meta?: Meta
}
export const MiroShape = ({
  shape = 'round_rectangle',
  content,
  width,
  height,
  style = {},
  meta = {},
}: Props) => {
  const id = useId()

  const shapeStyle = React.useMemo(() => {
    return Object.assign({}, defaultStyles, style)
  }, [style])

  const onDrop = React.useCallback(async (x: number, y: number) => {
    const shapeItem = await miro.board.createShape({
      x,
      y,
      width,
      height,
      shape,
      content: content,
      style: shapeStyle,
    });
    await Promise.all(Object.entries(meta).map(([key, value]) => {
      console.log('set', key, value)
      return shapeItem.setMetadata(key, value as any)
    }))
    await shapeItem.sync();
    console.log({ shapeItem })
  }, [content, height, meta, shape, shapeStyle, width])

  React.useEffect(() => {
    async function handleDrop({ x, y, target }: DropEvent) {
      if (target.dataset.id === id) {
        onDrop(x, y);
      }
    }

    miro.board.ui.on("drop", handleDrop);
    return () => miro.board.ui.off("drop", handleDrop);
  }, [id, onDrop]);

  return (
    <div className={classNames(
      'max-w-xs',
      'miro-draggable p-2', {
      'rounded-lg': shape === 'round_rectangle',
      'rounded-[100%]': shape === 'circle',

      'text-center': shapeStyle.textAlign === 'center',
      'text-left': shapeStyle.textAlign === 'left',
      'text-right': shapeStyle.textAlign === 'right',

      'flex flex-col justify-around': shapeStyle.textAlignVertical === 'middle',
      'flex flex-col justify-start': shapeStyle.textAlignVertical === 'top',
      'flex flex-col justify-end': shapeStyle.textAlignVertical === 'bottom',

      'border-solid': shapeStyle.borderStyle === 'normal',
      'border-0': shapeStyle.borderWidth === 0,
      'border-2': shapeStyle.borderWidth === 1,
      'border-4': shapeStyle.borderWidth === 2,
      'border-8': shapeStyle.borderWidth === 3,
    }
    )}
      style={{
        backgroundColor: shapeStyle.fillColor,
        aspectRatio: `${width}/${height}`,
        color: shapeStyle.color,
        borderColor: shapeStyle.borderColor,
      }}
      data-id={id}>
      <span>
        {content}
      </span>
    </div>
  )

}