import pandas as pd
import sys

pd.set_option('display.max_columns', None)
pd.set_option('display.max_rows', None)
pd.set_option('display.width', None)
pd.set_option('display.max_colwidth', 60)

files = [
    (r"C:\Users\rajar\Downloads\holdings-LXY076.xlsx", None),
    (r"C:\Users\rajar\Downloads\Stocks_Holdings_Statement_8336369076_2026-03-08.xlsx", None),
    (r"C:\Users\rajar\Downloads\IND-HOLDINGS_REPORTXX24034908-2026-03-08-V04 (1).xls", 'xlrd'),
    (r"C:\Users\rajar\Downloads\Stocks_PnL_8336369076_15-09-2024_07-03-2026_report (1).xlsx", None),
    (r"C:\Users\rajar\Downloads\IND-HOLDINGS_REPORTXX24034908-2026-03-08-V04.xls", 'xlrd'),
    (r"C:\Users\rajar\Downloads\pnl-LXY076.xlsx", None),
    (r"C:\Users\rajar\Downloads\Stocks_PnL_8336369076_15-09-2024_07-03-2026_report.xlsx", None),
]

for filepath, engine in files:
    print("=" * 140)
    print(f"FILE: {filepath}")
    print("=" * 140)
    try:
        if engine:
            xls = pd.ExcelFile(filepath, engine=engine)
        else:
            xls = pd.ExcelFile(filepath)
        sheet_names = xls.sheet_names
        print(f"Sheet names: {sheet_names}")

        for sheet in sheet_names:
            print(f"\n{'─' * 100}")
            print(f"SHEET: '{sheet}'")
            print(f"{'─' * 100}")

            # Read raw first to find actual header row
            if engine:
                df_raw = pd.read_excel(filepath, sheet_name=sheet, engine=engine, header=None)
            else:
                df_raw = pd.read_excel(filepath, sheet_name=sheet, header=None)

            # Find the first row that looks like a header (non-null in multiple columns)
            header_row = None
            for i in range(min(20, len(df_raw))):
                non_null = df_raw.iloc[i].notna().sum()
                if non_null >= 3:
                    # Check if it looks like a header (contains strings)
                    vals = df_raw.iloc[i].dropna().values
                    if all(isinstance(v, str) for v in vals):
                        header_row = i
                        break

            if header_row is not None:
                if engine:
                    df = pd.read_excel(filepath, sheet_name=sheet, engine=engine, header=header_row)
                else:
                    df = pd.read_excel(filepath, sheet_name=sheet, header=header_row)
            else:
                if engine:
                    df = pd.read_excel(filepath, sheet_name=sheet, engine=engine)
                else:
                    df = pd.read_excel(filepath, sheet_name=sheet)

            # Drop completely empty rows and columns
            df = df.dropna(how='all').dropna(axis=1, how='all')

            print(f"Detected header row: {header_row}")
            print(f"Shape after cleanup: {df.shape}")
            print(f"Columns: {list(df.columns)}")
            print(f"\nDTYPES:")
            for col in df.columns:
                print(f"  {col}: {df[col].dtype}")
            print(f"\nALL DATA:")
            print(df.to_string(index=False))
            print()

    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
    print()
