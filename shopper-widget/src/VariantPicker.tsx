// Selector de variantes: una fila por opción; cada elección deja habilitados solo los valores con stock para esa selección.
import { useEffect, useState } from 'react';
import type { Variant, VariantOption } from './bridge';

export type Selection = Record<string, string>;

type PickerProps = {
  options: VariantOption[];
  variants: Variant[];
  submitLabel: string;
  onChange?: (variant: Variant | null) => void;
  onPick: (variant: Variant) => void;
};

// Devuelve las opciones que hay que elegir: las que tienen más de un valor.
export function choosableOptions(options: VariantOption[]): VariantOption[] {
  return options.filter(option => option.values.length > 1);
}

// Dice si la variante coincide con todos los valores elegidos.
function matches(variant: Variant, selection: Selection): boolean {
  return Object.entries(selection).every(([name, value]) => variant.options[name] === value);
}

// Devuelve la selección sin la opción dada.
function without(selection: Selection, name: string): Selection {
  const rest = { ...selection };
  delete rest[name];
  return rest;
}

// Dice si un valor se puede elegir: hay alguna variante con stock con ese valor y lo ya elegido en las otras opciones.
export function isValueAvailable(variants: Variant[], selection: Selection, name: string, value: string): boolean {
  const others = without(selection, name);
  return variants.some(variant => variant.available && variant.options[name] === value && matches(variant, others));
}

// Devuelve la variante con stock que define la selección completa, o null si falta elegir o no hay.
export function selectedVariant(options: VariantOption[], variants: Variant[], selection: Selection): Variant | null {
  const missing = choosableOptions(options).some(option => !selection[option.name]);
  if (missing) return null;
  return variants.find(variant => variant.available && matches(variant, selection)) || null;
}

// Cambia la selección al tocar un valor: lo elige, o lo quita si ya estaba elegido.
export function toggleValue(selection: Selection, name: string, value: string): Selection {
  if (selection[name] === value) return without(selection, name);
  return { ...selection, [name]: value };
}

// Filas de opciones con sus valores y el botón para agregar la variante elegida.
export function VariantPicker({ options, variants, submitLabel, onChange, onPick }: PickerProps) {
  const [selection, setSelection] = useState<Selection>({});
  const variant = selectedVariant(options, variants, selection);

  // Avisa qué variante quedó elegida, para mostrar su imagen
  useEffect(() => { onChange?.(variant); }, [variant?.id]);

  // Elige o quita un valor de una opción
  const choose = (name: string, value: string) => setSelection(current => toggleValue(current, name, value));

  return <div className="gps-variant-picker">
    {choosableOptions(options).map(option => <div key={option.name} className="gps-variant-option" role="radiogroup" aria-label={option.name}>
      <span className="gps-variant-name">{option.name}</span>
      <div className="gps-variant-values">
        {option.values.map(value => {
          const selected = selection[option.name] === value;
          const available = isValueAvailable(variants, selection, option.name, value);
          const className = ['gps-variant-value', selected && 'is-selected', !available && 'is-unavailable'].filter(Boolean).join(' ');
          return <button key={value} type="button" role="radio" className={className}
            aria-checked={selected ? 'true' : 'false'}
            disabled={!available && !selected}
            onClick={() => choose(option.name, value)}>
            {value}
          </button>;
        })}
      </div>
    </div>)}
    <button type="button" className="gps-variant-submit" disabled={!variant} onClick={() => variant && onPick(variant)}>{submitLabel}</button>
  </div>;
}
