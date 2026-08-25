package replication

import (
	"testing"

	"github.com/go-logr/logr"
)

func TestParseGtid(t *testing.T) {
	logger := logr.Discard()

	tests := []struct {
		name         string
		input        string
		gtidDomainId uint32
		wantGtid     *Gtid
		wantErr      bool
	}{
		{
			name:         "empty",
			input:        "",
			gtidDomainId: 0,
			wantGtid:     nil,
			wantErr:      true,
		},
		{
			name:         "invalid",
			input:        "foo",
			gtidDomainId: 0,
			wantGtid:     nil,
			wantErr:      true,
		},
		{
			name:     "too few parts",
			input:    "1-2",
			wantGtid: nil,
			wantErr:  true,
		},
		{
			name:     "too many parts",
			input:    "1-2-3-4",
			wantGtid: nil,
			wantErr:  true,
		},
		{
			name:     "non-numeric domain",
			input:    "a-2-3",
			wantGtid: nil,
			wantErr:  true,
		},
		{
			name:     "non-numeric server",
			input:    "1-b-3",
			wantGtid: nil,
			wantErr:  true,
		},
		{
			name:     "non-numeric sequence",
			input:    "1-2-c",
			wantGtid: nil,
			wantErr:  true,
		},
		{
			name:         "all zero",
			input:        "0-0-0",
			gtidDomainId: 0,
			wantGtid: &Gtid{
				DomainID:   0,
				ServerID:   0,
				SequenceID: 0,
			},
			wantErr: false,
		},
		{
			name:         "valid",
			input:        "0-2001-48431",
			gtidDomainId: 0,
			wantGtid: &Gtid{
				DomainID:   0,
				ServerID:   2001,
				SequenceID: 48431,
			},
			wantErr: false,
		},
		{
			name:         "max values",
			input:        "0-4294967295-18446744073709551615",
			gtidDomainId: 0,
			wantGtid: &Gtid{
				DomainID:   0,
				ServerID:   4294967295,
				SequenceID: 18446744073709551615,
			},
			wantErr: false,
		},
		{
			name:         "multiple GTID, some invalid",
			input:        "2-a-48438,0-2001-48431,1-2101-48436",
			gtidDomainId: 0,
			wantGtid: &Gtid{
				DomainID:   0,
				ServerID:   2001,
				SequenceID: 48431,
			},
			wantErr: false,
		},
		{
			name:         "multiple GTID, some empty",
			input:        ",0-2002-48432",
			gtidDomainId: 0,
			wantGtid: &Gtid{
				DomainID:   0,
				ServerID:   2002,
				SequenceID: 48432,
			},
			wantErr: false,
		},
		{
			name:         "multiple GTID from same domain",
			input:        "0-2001-48431,0-2002-48432",
			gtidDomainId: 0,
			wantGtid: &Gtid{
				DomainID:   0,
				ServerID:   2001,
				SequenceID: 48431,
			},
			wantErr: false,
		},
		{
			name:         "1. multiple GTID from different domains",
			input:        "2-2201-48438,1-2101-48436,0-2001-48431",
			gtidDomainId: 0,
			wantGtid: &Gtid{
				DomainID:   0,
				ServerID:   2001,
				SequenceID: 48431,
			},
			wantErr: false,
		},
		{
			name:         "2. multiple GTID from different domains",
			input:        "0-2001-48431,2-2201-48438,1-2101-48436",
			gtidDomainId: 0,
			wantGtid: &Gtid{
				DomainID:   0,
				ServerID:   2001,
				SequenceID: 48431,
			},
			wantErr: false,
		},
		{
			name:         "3. multiple GTID from different domains",
			input:        "2-2201-48438,0-2001-48431,1-2101-48436",
			gtidDomainId: 0,
			wantGtid: &Gtid{
				DomainID:   0,
				ServerID:   2001,
				SequenceID: 48431,
			},
			wantErr: false,
		},
		{
			name:         "multiple GTID from different domains using non default domain",
			input:        "2-2201-48438,1-2101-48436,0-2001-48431",
			gtidDomainId: 1,
			wantGtid: &Gtid{
				DomainID:   1,
				ServerID:   2101,
				SequenceID: 48436,
			},
			wantErr: false,
		},
		{
			name:         "domain not found",
			input:        "2-2201-48438,1-2101-48436,0-2001-48431",
			gtidDomainId: 5,
			wantGtid:     nil,
			wantErr:      true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseGtidWithDomainId(tc.input, tc.gtidDomainId, logger)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for input %q, got nil and result %#v", tc.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for input %q: %v", tc.input, err)
			}
			//nolint:staticcheck
			if got == nil {
				t.Fatalf("expected non-nil result for input %q", tc.input)
			}
			//nolint:staticcheck
			if got.DomainID != tc.wantGtid.DomainID || got.ServerID != tc.wantGtid.ServerID || got.SequenceID != tc.wantGtid.SequenceID {
				t.Fatalf("parse mismatch for input %q: got %+v, want %+v", tc.input, got, tc.wantGtid)
			}
		})
	}
}

// TestParseGtidWithDomainId targets ParseGtidWithDomainId directly (as
// opposed to TestParseGtid above, which primarily exercises ParseGtid).
// Before the fix, the loop reassigned the outer rawGtid parameter to the
// trimmed value of each part, but checked emptiness against the *untrimmed*
// part. A part consisting solely of whitespace (e.g. a single space) is not
// caught by `part == ""`, so it fell through to ParseGtid on the (already
// trimmed-to-empty) value, which errors out and is logged at error level
// instead of being cleanly skipped with an info-level "Ignoring empty GTID"
// log. The fix introduces a properly scoped `trimmed` local, checks
// `trimmed == ""`, and calls ParseGtid(trimmed).
//
// Note: for a whitespace-only part, both the old and fixed code end up
// calling continue and moving on to the next part - the final returned
// *Gtid/error from ParseGtidWithDomainId is identical in both versions; the
// only observable difference is which log statement fires (Error vs Info).
// The "whitespace-only part is skipped" case below therefore passes
// identically whether or not the fix is applied - it is verified against
// the old code manually rather than via a fail/pass test. These tests still
// close a real coverage gap: ParseGtidWithDomainId previously had no
// dedicated tests around whitespace handling.
func TestParseGtidWithDomainId(t *testing.T) {
	logger := logr.Discard()

	tests := []struct {
		name         string
		input        string
		gtidDomainId uint32
		wantGtid     *Gtid
		wantErr      bool
	}{
		{
			name:         "whitespace-only part is skipped",
			input:        "0-1-5, ,1-2-6",
			gtidDomainId: 1,
			wantGtid: &Gtid{
				DomainID:   1,
				ServerID:   2,
				SequenceID: 6,
			},
			wantErr: false,
		},
		{
			name:         "leading and trailing whitespace around parts is trimmed",
			input:        " 2-9-10 , 3-1-2 ",
			gtidDomainId: 2,
			wantGtid: &Gtid{
				DomainID:   2,
				ServerID:   9,
				SequenceID: 10,
			},
			wantErr: false,
		},
		{
			name:         "truly empty part between commas is skipped",
			input:        "0-1-5,,1-2-6",
			gtidDomainId: 1,
			wantGtid: &Gtid{
				DomainID:   1,
				ServerID:   2,
				SequenceID: 6,
			},
			wantErr: false,
		},
		{
			name:         "multiple whitespace-only parts mixed with valid ones",
			input:        "  ,0-1-5,\t,1-2-6,   ",
			gtidDomainId: 1,
			wantGtid: &Gtid{
				DomainID:   1,
				ServerID:   2,
				SequenceID: 6,
			},
			wantErr: false,
		},
		{
			name:         "non-matching domain is ignored, domain not found",
			input:        "0-1-5,1-2-6",
			gtidDomainId: 9,
			wantGtid:     nil,
			wantErr:      true,
		},
		{
			name:         "single GTID without comma delegates to ParseGtid",
			input:        "3-4-5",
			gtidDomainId: 3,
			wantGtid: &Gtid{
				DomainID:   3,
				ServerID:   4,
				SequenceID: 5,
			},
			wantErr: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseGtidWithDomainId(tc.input, tc.gtidDomainId, logger)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for input %q, got nil and result %#v", tc.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for input %q: %v", tc.input, err)
			}
			if got == nil {
				t.Fatalf("expected non-nil result for input %q", tc.input)
			}
			if got.DomainID != tc.wantGtid.DomainID || got.ServerID != tc.wantGtid.ServerID || got.SequenceID != tc.wantGtid.SequenceID {
				t.Fatalf("parse mismatch for input %q: got %+v, want %+v", tc.input, got, tc.wantGtid)
			}
		})
	}
}

func TestParseRawGtidInMetaFile(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantGtid string
		wantErr  bool
	}{
		{
			name:    "empty file",
			input:   "",
			wantErr: true,
		},
		{
			name:    "one field only",
			input:   "mariadb-repl-bin.000003",
			wantErr: true,
		},
		{
			name:    "two fields only",
			input:   "mariadb-repl-bin.000004 456",
			wantErr: true,
		},
		{
			name:     "valid format",
			input:    "mariadb-repl-bin.000001 335 0-10-9",
			wantGtid: "0-10-9",
			wantErr:  false,
		},
		{
			name:     "extra spaces and newline",
			input:    "  mariadb-repl-bin.000002   123    1-2-3  \n",
			wantGtid: "1-2-3",
			wantErr:  false,
		},
		{
			name:     "tabs between fields",
			input:    "bin\t12\t2-3-4",
			wantGtid: "2-3-4",
			wantErr:  false,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseRawGtidInMetaFile([]byte(tc.input))
			if tc.wantErr && err == nil {
				t.Fatal("error expected, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.wantGtid {
				t.Fatalf("gtid mismatch: want=%q got=%q", tc.wantGtid, got)
			}
		})
	}
}
