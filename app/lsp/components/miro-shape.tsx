import type { DropEvent, Shape } from '@mirohq/websdk-types';
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
  borderWidth: 1,
  fontSize: 28,
}

type Meta = {
  projectName?: string,
  path?: string
}


type Props<M extends Meta> = {
  shape?: ShapeProps['shape']
  content: React.ReactNode,
  onDrop?: (shape: Shape) => void,
  width: number,
  height: number,
  style?: ShapeProps['style']
  meta?: M
}
export const MiroShape = <M extends Meta>({
  shape = 'round_rectangle',
  content,
  width,
  onDrop,
  height,
  style = {},
  meta,
}: Props<M>) => {
  const id = useId()
  const self = React.useRef<HTMLDivElement>(null)

  const shapeStyle = React.useMemo(() => {
    return Object.assign({}, defaultStyles, style)
  }, [style])

  const handleDrop = React.useCallback(async (x: number, y: number) => {
    const zoom = await miro.board.viewport.getZoom()
    const shapeItem = await miro.board.createShape({
      x,
      y,
      width: width / zoom,
      height: height / zoom,
      shape,
      content: self.current?.innerHTML ?? '(empty)',
      style: {
        ...shapeStyle,
        fontSize: Math.round(shapeStyle.fontSize / zoom),
      },
    });
    await Promise.all(Object.entries(meta || {}).map(async ([key, value]) => {
      if (value != null) {
        console.log('set', key, value)
        return shapeItem.setMetadata(key, value as any)
      }
    }))
    await shapeItem.sync();
    onDrop?.(shapeItem)
  }, [height, meta, onDrop, shape, shapeStyle, width])

  React.useEffect(() => {
    async function dropHandle({ x, y, target }: DropEvent) {
      if (target.dataset.id === id) {
        handleDrop(x, y);
      }
    }

    miro.board.ui.on("drop", dropHandle);
    return () => miro.board.ui.off("drop", dropHandle);
  }, [id, handleDrop]);

  return (
    <div
      ref={self}
      className={classNames(
        'max-w-xs',
        'miro-draggable draggable-item relative p-2', {
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
        fontSize: shapeStyle.fontSize,
      }}
      data-id={id}>
      <span>
        {content}
      </span>
    </div>
  )

}