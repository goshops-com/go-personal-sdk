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

// Devuelve las opciones que hay que elegir, solo con sus valores con stock; una opción con un solo valor no se elige.
export function choosableOptions(options: VariantOption[], variants: Variant[]): VariantOption[] {
  const hasStock = (name: string, value: string) => variants.some(variant => variant.available && variant.options[name] === value);
  const inStock = options.map(option => ({ name: option.name, values: option.values.filter(value => hasStock(option.name, value)) }));
  return inStock.filter(option => option.values.length > 1);
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
  const missing = choosableOptions(options, variants).some(option => !selection[option.name]);
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
    {choosableOptions(options, variants).map(option => <div key={option.name} className="gps-variant-option" role="radiogroup" aria-label={option.name}>
      <span className="gps-variant-name">{option.name}</span>
      <div className="gps-variant-values">
        {option.values.map(value => {
          // Solo se muestran los valores con stock para lo ya elegido, y el que está elegido
          const selected = selection[option.name] === value;
          if (!selected && !isValueAvailable(variants, selection, option.name, value)) return null;
          return <button key={value} type="button" role="radio" className={selected ? 'gps-variant-value is-selected' : 'gps-variant-value'}
            aria-checked={selected ? 'true' : 'false'}
            onClick={() => choose(option.name, value)}>
            {value}
          </button>;
        })}
      </div>
    </div>)}
    <button type="button" className="gps-variant-submit" disabled={!variant} onClick={() => variant && onPick(variant)}>{submitLabel}</button>
  </div>;
}
