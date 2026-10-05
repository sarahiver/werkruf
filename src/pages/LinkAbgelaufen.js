/**
 * Landeseite für nicht mehr gültige Mail-Links.
 *
 * Ein Link kann aus vielen Gründen nicht mehr gelten: abgelaufen,
 * widerrufen, der Betrieb wurde gelöscht, die Empfehlung ist erledigt.
 *
 * Der Besucher erfährt keinen davon.
 *
 * „Abgelaufen" verriete, dass es den Link gab. „Gehört einem anderen
 * Konto" verriete mehr. Wer einen fremden Link in die Hand bekommt,
 * soll daraus nichts lernen können.
 *
 * Deshalb eine Auskunft für alle Fälle — und ein Weg weiter. Die
 * Aufgabe liegt im Dashboard; der Link war nur eine Abkürzung dorthin.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { Clock, ArrowRight } from 'lucide-react';

const Seite = styled.main`
  min-height: 70vh; display: flex; align-items: center; justify-content: center;
  padding: 40px 20px;
`;

const Karte = styled.div`
  max-width: 480px; text-align: center;
  background: #fff; border: 1px solid var(--color-border);
  border-radius: 12px; padding: 36px 32px;
`;

const Symbol = styled.div`
  width: 52px; height: 52px; border-radius: 50%;
  background: #F4F5F7; color: var(--color-text-muted);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 18px;
`;

const Titel = styled.h1`
  font-family: var(--font-display); font-size: 1.3rem;
  color: var(--color-primary); margin: 0 0 10px;
`;

const Text = styled.p`
  font-family: var(--font-body); font-size: .92rem; line-height: 1.65;
  color: var(--color-text-muted); margin: 0 0 24px;
`;

const Knopf = styled(Link)`
  font-family: var(--font-body); font-size: .92rem; font-weight: 600;
  display: inline-flex; align-items: center; gap: 7px;
  background: var(--color-primary); color: #fff; text-decoration: none;
  border-radius: 7px; padding: 12px 22px;
  &:hover { opacity: .9; }
`;

export default function LinkAbgelaufen() {
  return (
    <Seite>
      <Karte>
        <Symbol><Clock size={24} /></Symbol>

        <Titel>Dieser Link ist nicht mehr gültig.</Titel>

        <Text>
          Links aus WERKRUF-Mails gelten eine Woche. Melde dich im Dashboard an —
          deine offenen Aufgaben liegen dort bereit.
        </Text>

        <Knopf to="/dashboard">
          Zum Dashboard <ArrowRight size={15} />
        </Knopf>
      </Karte>
    </Seite>
  );
}
