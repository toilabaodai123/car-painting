module user-service-go

go 1.22.0

replace common-golang => ../common-golang

require (
	common-golang v0.0.0-00010101000000-000000000000
	github.com/lib/pq v1.10.9
)
