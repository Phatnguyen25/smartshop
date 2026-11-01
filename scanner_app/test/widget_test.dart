import 'package:flutter_test/flutter_test.dart';
import 'package:scanner_app/main.dart';

void main() {
  testWidgets('SmartShopScannerApp builds', (WidgetTester tester) async {
    await tester.pumpWidget(const SmartShopScannerApp());
    expect(find.text('SmartShop Scanner'), findsOneWidget);
  });
}
