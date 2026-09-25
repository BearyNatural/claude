import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useGardenView } from '../../src/state/hooks';
import { Button, Notice, Screen } from '../../src/ui/components/primitives';
import { AreaForm, validateAreaDraft, type AreaDraft } from '../../src/ui/forms/areaForm';

export default function EditArea() {
  const { id, returnTo } = useLocalSearchParams<{ id?: string; returnTo?: string }>();
  const { data, store } = useGardenView();
  const existing = id ? data.areas.find((a) => a.id === id) : undefined;
  const [draft, setDraft] = useState<AreaDraft>(existing ?? { name: '', type: 'vegetable-bed' });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateAreaDraft(draft);

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    try {
      const a = await store.saveArea(draft);
      // Opened from a planting form: go back so the new area can be picked there.
      if (existing || returnTo === 'back') router.back();
      else router.replace(`/area/${a.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen>
      <AreaForm draft={draft} onChange={setDraft} errors={touched ? errors : {}} />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={existing ? 'Save changes' : 'Add area'} icon="checkmark" onPress={save} />
    </Screen>
  );
}
