import React, { useState, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { Search } from 'lucide-react';

const spin = keyframes`to{transform:rotate(360deg)}`;

const Wrap = styled.div`position: relative;`;

const SearchIcon = styled.div`
  position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
  color: var(--color-accent); display: flex; align-items: center;
  z-index: 5; pointer-events: none;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 13px 40px 13px 40px;
  border: 2px solid ${({ $dark }) => $dark ? 'rgba(255,255,255,.15)' : 'var(--color-border)'};
  background: ${({ $dark }) => $dark ? 'rgba(255,255,255,.07)' : 'var(--color-bg)'};
  color: ${({ $dark }) => $dark ? 'white' : 'var(--color-text)'};
  font-family: var(--font-body); font-size: 1rem;
  outline: none; border-radius: var(--radius-card);
  transition: border-color .2s, background .2s;

  &:focus {
    border-color: var(--color-accent);
    background: ${({ $dark }) => $dark ? 'rgba(255,255,255,.12)' : 'var(--color-white)'};
  }
  &::placeholder {
    color: ${({ $dark }) => $dark ? 'rgba(255,255,255,.4)' : '#A0ADB8'};
  }
`;

const Spinner = styled.div`
  position: absolute; right: 13px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px;
  border: 2px solid rgba(var(--color-accent-rgb), .3);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: ${spin} .7s linear infinite;
`;

const ClearBtn = styled.button`
  position: absolute; right: 13px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; padding: 2px;
  color: ${({ $dark }) => $dark ? 'rgba(255,255,255,.4)' : '#A0ADB8'};
  display: flex; align-items: center;
  &:hover { color: ${({ $dark }) => $dark ? 'white' : 'var(--color-primary)'}; }
`;

const List = styled.ul`
  position: absolute; top: calc(100% + 2px); left: 0; right: 0;
  background: var(--color-white);
  border: 2px solid var(--color-primary);
  border-top: none;
  border-radius: 0 0 var(--radius-card) var(--radius-card);
  list-style: none; z-index: 200;
  max-height: 280px; overflow-y: auto;
  box-shadow: 0 8px 24px rgba(var(--color-primary-rgb), .14);
`;

const ListItem = styled.li`
  padding: 11px 14px; cursor: pointer;
  border-bottom: 1px solid var(--color-border);
  &:last-child { border-bottom: none; }
  &:hover { background: rgba(var(--color-primary-rgb), .05); }
`;

const ItemMain = styled.p`
  font-family: var(--font-body); font-size: .9rem;
  color: var(--color-primary); font-weight: 600;
`;

const ItemSec = styled.p`
  font-family: var(--font-body); font-size: .78rem;
  color: var(--color-text-muted); margin-top: 1px;
`;

const NoResults = styled.li`
  padding: 12px 14px;
  font-family: var(--font-body); font-size: .85rem;
  color: var(--color-text-muted); text-align: center;
`;

/* ─────────────────────────────────────────────
   COMPONENT
   Props:
     onSelect(result)  — { placeId, name, label }
     placeholder       — string
     dark              — bool (for hero on dark bg)
     style             — optional style override
───────────────────────────────────────────── */
export default function PlacesSearch({ onSelect, placeholder, dark = false, style }) {
  const [query,       setQuery]       = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [open,        setOpen]        = useState(false);
  const [searched,    setSearched]    = useState(false);
  const debounceRef = useRef(null);

  const search = (val) => {
    setQuery(val);
    setSearched(false);

    if (!val.trim() || val.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      let found = false;

      // 1. Try new Places API (v1)
      if (window.google?.maps?.places?.AutocompleteSuggestion) {
        try {
          const { suggestions: suggs } =
            await window.google.maps.places.AutocompleteSuggestion
              .fetchAutocompleteSuggestions({
                input: val,
                includedPrimaryTypes: ['establishment'],
                includedRegionCodes:  ['de'],
              });
          setSuggestions(suggs || []);
          setOpen(true);
          setSearched(true);
          found = true;
        } catch (_) {
          found = false;
        }
      }

      // 2. Fallback: legacy AutocompleteService
      if (!found && window.google?.maps?.places?.AutocompleteService) {
        const svc = new window.google.maps.places.AutocompleteService();
        svc.getPlacePredictions(
          {
            input: val,
            componentRestrictions: { country: 'de' },
            types: ['establishment'],
          },
          (predictions, status) => {
            const mapped = status === 'OK'
              ? predictions.map(p => ({
                  placePrediction: {
                    placeId:       p.place_id,
                    text:          { text: p.description },
                    mainText:      { text: p.structured_formatting.main_text },
                    secondaryText: { text: p.structured_formatting.secondary_text || '' },
                  },
                }))
              : [];
            setSuggestions(mapped);
            setOpen(true);
            setSearched(true);
          }
        );
      }

      setLoading(false);
    }, 320);
  };

  const handleSelect = (sugg) => {
    const pred   = sugg.placePrediction;
    const name   = pred.mainText?.text || pred.text?.text || '';
    const label  = pred.text?.text || name;
    setQuery(name);
    setOpen(false);
    setSuggestions([]);
    if (onSelect) onSelect({ placeId: pred.placeId, name, label });
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setSearched(false);
    if (onSelect) onSelect(null);
  };

  return (
    <Wrap style={style}>
      <SearchIcon><Search size={17} /></SearchIcon>

      <SearchInput
        value={query}
        onChange={e => search(e.target.value)}
        placeholder={placeholder || 'Betrieb suchen…'}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        $dark={dark}
        autoComplete="off"
      />

      {loading && <Spinner />}
      {!loading && query && (
        <ClearBtn $dark={dark} onMouseDown={handleClear} type="button">
          ✕
        </ClearBtn>
      )}

      {open && (
        <List>
          {suggestions.length > 0
            ? suggestions.map((s, i) => {
                const pred = s.placePrediction;
                const main = pred.mainText?.text || pred.text?.text || '';
                const sec  = pred.secondaryText?.text || '';
                return (
                  <ListItem key={i} onMouseDown={() => handleSelect(s)}>
                    <ItemMain>{main}</ItemMain>
                    {sec && <ItemSec>{sec}</ItemSec>}
                  </ListItem>
                );
              })
            : searched && (
                <NoResults>Kein Treffer — versuch es genauer.</NoResults>
              )
          }
        </List>
      )}
    </Wrap>
  );
}
