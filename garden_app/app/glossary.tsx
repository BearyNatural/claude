import React from 'react';
import { GLOSSARY } from '../src/data/glossary';
import { Card, Screen, T } from '../src/ui/components/primitives';

export default function Glossary() {
  return (
    <Screen>
      <T variant="small" muted>Tap the ? next to a word anywhere in the app for a quick explanation.</T>
      {GLOSSARY.map((g) => (
        <Card key={g.id}>
          <T variant="h3">{g.term}</T>
          <T variant="small">{g.short}</T>
          {g.more ? <T variant="small" muted>{g.more}</T> : null}
        </Card>
      ))}
    </Screen>
  );
}
