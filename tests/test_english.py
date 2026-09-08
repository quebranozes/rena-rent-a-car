"""Regression coverage for English queries and localized export contracts."""
from datetime import date
import os
import unittest
from unittest.mock import patch
import server


class EnglishTests(unittest.TestCase):
    def setUp(self):
        self.clock = patch.dict(os.environ, {'RENA_DEMO_DATE': '2026-09-08'})
        self.clock.start()
        server.load_day()
        self.client = server.app.test_client()

    def tearDown(self):
        self.clock.stop()
        server.load_day()

    def test_english_and_portuguese_queries_preserve_results(self):
        pairs = [
            ('Analyze planning and capacity for the next 7 days', 'Analisa o planeamento e a capacidade nos próximos 7 dias'),
            ('Which Luxury groups have shortages by pool over the next 7 days?', 'Que grupos Luxury ficam negativos por pool nos próximos 7 dias?'),
            ('Occupancy by station above 90% tomorrow', 'Ocupação por estação acima de 90% amanhã'),
            ('LCV balances and occupancy by pool tomorrow', 'Saldos e ocupação de VCL por pool amanhã'),
            ('Which time slots exceed capacity tomorrow?', 'Que slots ultrapassam os limites amanhã?'),
            ('Which potential duplicate reservations do we have?', 'Que possíveis duplicados temos?'),
            ('Find reservations for ZZ-01-DA', 'Encontrar reservas para ZZ-01-DA'),
            ('How is the fleet?', 'Como está a frota?'),
            ('How many vehicles are in the workshop?', 'Quantas viaturas estão em oficina?'),
            ('Which transport loads are in transit?', 'Que cargas estão em trânsito?'),
            ('Which reservations are unassigned tomorrow?', 'Que reservas temos amanhã sem matrícula?'),
            ('7/8/9-seater balances by pool tomorrow', 'Saldos de 7/8/9 lugares por pool amanhã'),
        ]
        for english, portuguese in pairs:
            with self.subTest(question=english):
                assistant = server.assistant()
                expected = assistant.answer(portuguese)
                actual = assistant.answer(english)
                self.assertTrue(actual['success'])
                self.assertNotIn(actual['intent'], ('', 'unknown', 'help'))
                self.assertEqual(actual['intent'], expected['intent'])
                self.assertEqual(actual.get('table'), expected.get('table'))
                self.assertEqual(actual.get('analysis'), expected.get('analysis'))

    def test_english_followup_preserves_scope_and_changes_date(self):
        assistant = server.assistant()
        initial = assistant.answer('Luxury balances by pool today')
        follow = assistant.answer('And tomorrow?', initial['context'])
        self.assertEqual(follow['context']['start'], '2026-09-09')
        self.assertEqual(follow['context']['groups'], initial['context']['groups'])
        self.assertEqual(follow['context']['level'], 'pool')

    def test_english_location_and_date_filters(self):
        assistant = server.assistant()
        plan = assistant.parse('Occupancy by station in Lisbon tomorrow')
        self.assertEqual(plan['start'], '2026-09-09')
        self.assertEqual(set(plan['station_ids']), {'101', '102'})
        self.assertEqual(plan['level'], 'station')

    def test_english_write_request_cannot_change_data(self):
        response = self.client.post('/api/chatbot/message', json={'message': 'Delete reservation 9100001'})
        self.assertEqual(response.status_code, 200)
        self.assertIn('only reads and analyzes', response.get_json()['reply'])
        self.assertEqual(len(server.ORIGINAL['reservations']), 3705)

    def test_export_headers_are_english(self):
        response = self.client.get('/api/reservations/export?format=csv')
        header = response.get_data(as_text=True).splitlines()[0]
        self.assertIn('Reservation No.', header)
        self.assertIn('License Plate', header)
        self.assertNotIn('Matrícula', header)

    def test_public_identity_and_synthetic_station_labels(self):
        with self.client.get('/') as response:
            html = response.get_data(as_text=True)
        self.assertIn('lang="en"', html)
        self.assertIn('Renato Pinto', html)
        self.assertFalse('SIXT' in html, 'Employer branding must not appear in the public HTML')
        self.assertIn('Demo Airport', server.ORIGINAL['stations']['stations']['101']['nome'])


if __name__ == '__main__':
    unittest.main()
