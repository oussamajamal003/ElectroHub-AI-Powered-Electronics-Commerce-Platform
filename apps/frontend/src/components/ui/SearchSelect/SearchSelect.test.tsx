import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SearchSelect, type SearchSelectOption } from './SearchSelect';

const options: SearchSelectOption[] = [
  { value: 'a', label: 'Audio' }, { value: 'h', label: 'Hidden bin', disabled: true }, { value: 'l', label: 'Laptops' },
  { value: 's', label: 'stripe-acceptance-1218e692-079c-42ad-bd6c-303aa5213c9b' },
];
function Harness() {
  const [value, setValue] = useState<string | undefined>('l');
  return <><SearchSelect label="Category" options={options} value={value} onValueChange={setValue} /><output>{value}</output></>;
}

describe('SearchSelect', () => {
  it('opens from the keyboard on the selected option and skips disabled options', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /Category/ });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const search = screen.getByRole('combobox', { name: 'Search category' });
    expect(search).toHaveFocus();
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Laptops' }).id);
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Audio' }).id);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByText('a', { selector: 'output' })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('type-to-search from the trigger filters, and Escape closes without changing the value', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Category/ }), { key: 's' });
    const listbox = screen.getByRole('listbox');
    expect(screen.getByRole('combobox', { name: 'Search category' })).toHaveValue('s');
    expect(within(listbox).getAllByRole('option').map(option => option.getAttribute('title'))).toEqual(['Laptops', 'stripe-acceptance-1218e692-079c-42ad-bd6c-303aa5213c9b']);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search category' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('l', { selector: 'output' })).toBeInTheDocument();
  });

  it('says when nothing matches', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Category/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search category' }), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
