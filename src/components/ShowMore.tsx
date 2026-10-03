import React, { useState } from 'react';
import { View } from 'react-native';
import { Btn } from './ui';

/**
 * Renders a long list inside a ScrollView in pages ("Tampilkan lagi") instead
 * of all at once — e.g. an ARCO's weekly report queue or a 195-NC rollup,
 * where mapping every row up front made the screen slow to open. (A nested
 * FlatList can't virtualize inside a ScrollView.)
 */
export function ShowMore<T>({
  items,
  render,
  pageSize = 25,
}: {
  items: T[];
  render: (item: T, index: number) => React.ReactNode;
  pageSize?: number;
}) {
  const [count, setCount] = useState(pageSize);
  const rest = items.length - count;
  return (
    <>
      {items.slice(0, count).map(render)}
      {rest > 0 && (
        <View style={{ alignSelf: 'center', marginTop: 4 }}>
          <Btn
            small
            variant="outline"
            title={`Tampilkan ${Math.min(pageSize, rest)} lagi (${rest} tersisa)`}
            onPress={() => setCount((c) => c + pageSize)}
          />
        </View>
      )}
    </>
  );
}
