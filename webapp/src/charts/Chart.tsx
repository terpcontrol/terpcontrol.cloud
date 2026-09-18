import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import { DatasetComponent, GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { useEffect, useRef } from 'react';
import { readChartPalette, type ChartPalette } from './tokens';

/**
 * The whole of ECharts in this app. Registering the pieces by hand rather than
 * importing the bundle keeps everything the screens do not draw out of the
 * download; a chart type a later screen needs is a line here.
 */
echarts.use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, DatasetComponent, MarkAreaComponent, MarkLineComponent]);

export type ChartOption = echarts.EChartsCoreOption;

interface ChartProps {
  /** Built from the palette, so the same series is drawn in either mode without a second option object. */
  option: (palette: ChartPalette) => ChartOption;
  height: number;
  ariaLabel: string;
}

/**
 * ECharts owns its canvas and React owns the element it sits in - so the option
 * is pushed in an effect and the instance is never in state. It is re-read when
 * the mode changes, because the colours come from the document, not from props.
 */
export function Chart({ option, height, ariaLabel }: ChartProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const instance = echarts.init(element, undefined, { renderer: 'canvas' });
    const draw = () => instance.setOption(option(readChartPalette()), true);
    draw();

    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(element);

    // The manual toggle writes `data-theme`; the system's preference changes it
    // without touching the DOM at all, so both are watched.
    const themeAttribute = new MutationObserver(draw);
    themeAttribute.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    systemTheme.addEventListener('change', draw);

    return () => {
      resize.disconnect();
      themeAttribute.disconnect();
      systemTheme.removeEventListener('change', draw);
      instance.dispose();
    };
  }, [option]);

  return <div ref={host} role="img" aria-label={ariaLabel} style={{ height }} />;
}
