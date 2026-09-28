import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlacesSearch from './PlacesSearch';

let listener;
let currentPlace;

function installGoogle() {
  class Autocomplete {
    addListener(_event, callback) { listener = callback; }
    getPlace() { return currentPlace; }
  }
  window.google = { maps: { places: { Autocomplete }, event: { clearInstanceListeners: jest.fn() } } };
}

describe('PlacesSearch', () => {
  beforeEach(() => { listener = null; currentPlace = null; installGoogle(); });
  afterEach(() => { delete window.google; });

  it('normalises a successful suggestion and supports a second selection', async () => {
    const onSelect = jest.fn();
    render(<PlacesSearch onSelect={onSelect} />);
    await waitFor(() => expect(listener).toBeTruthy());

    currentPlace = { place_id: 'one', name: 'Erster Betrieb', formatted_address: 'Hamburg', rating: 4.5, user_ratings_total: 12, website: 'https://one.test' };
    act(() => listener());
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ placeId: 'one', name: 'Erster Betrieb', reviewCount: 12 }));

    currentPlace = { place_id: 'two', name: 'Zweiter Betrieb', rating: 4, user_ratings_total: 3 };
    act(() => listener());
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ placeId: 'two', name: 'Zweiter Betrieb' }));
  });

  it('preserves true zero values and marks omitted fields unavailable', async () => {
    const onSelect = jest.fn();
    render(<PlacesSearch onSelect={onSelect} />);
    await waitFor(() => expect(listener).toBeTruthy());
    currentPlace = { place_id: 'new', name: 'WERKRUF', user_ratings_total: 0 };
    act(() => listener());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      reviewCount: 0, reviewCountAvailable: true, rating: null,
      ratingAvailable: false, websiteAvailable: false,
    }));
  });

  it('clears the field when the funnel is reset', async () => {
    const { rerender } = render(<PlacesSearch resetKey={0} />);
    await waitFor(() => expect(listener).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Betrieb suchen'), { target: { value: 'Firma' } });
    rerender(<PlacesSearch resetKey={1} />);
    expect(screen.getByLabelText('Betrieb suchen')).toHaveValue('');
  });

  it('hands a typed, not-found business to the manual fallback', async () => {
    const onNoResults = jest.fn();
    render(<PlacesSearch onNoResults={onNoResults} />);
    await waitFor(() => expect(listener).toBeTruthy());
    jest.useFakeTimers();
    const input = screen.getByLabelText('Betrieb suchen');
    fireEvent.change(input, { target: { value: 'Ohne Google GmbH' } });
    fireEvent.blur(input);
    act(() => jest.advanceTimersByTime(301));
    fireEvent.click(screen.getByText(/manuell eintragen/i));
    expect(onNoResults).toHaveBeenCalledWith('Ohne Google GmbH');
    jest.useRealTimers();
  });

  it('keeps manual entry possible when the Google API fails', async () => {
    delete window.google;
    jest.useFakeTimers();
    render(<PlacesSearch onNoResults={jest.fn()} />);
    await act(async () => {
      jest.advanceTimersByTime(10100);
      await Promise.resolve();
    });
    const input = screen.getByLabelText('Betrieb suchen');
    expect(input).not.toBeDisabled();
    expect(input.placeholder).toContain('Google Maps');
    jest.useRealTimers();
  });
});
